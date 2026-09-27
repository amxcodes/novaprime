-- Proves that NOVA lifecycle state gates Better Auth session creation without
-- making Better Auth a source of domain authorization.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA session lifecycle test',
  'session-admin@example.test',
  'Session Admin',
  'better-auth-subject-session-admin'
);

DO $$
DECLARE
  v_admin_id uuid;
  v_organisation_id uuid;
  v_person_id uuid;
  v_transition_at timestamptz := clock_timestamp();
BEGIN
  SELECT user_id, organisation_id
  INTO v_admin_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-session-admin');

  PERFORM set_config('nova.user_id', v_admin_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'frozen-person@example.test', 'Frozen Person')
  RETURNING id INTO v_person_id;

  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (v_person_id, 'better_auth', 'better-auth-subject-frozen-person');

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (v_person_id, 'active', v_transition_at - interval '1 second');

  IF NOT nova.can_create_auth_session('better-auth-subject-frozen-person') THEN
    RAISE EXCEPTION 'active person could not create an authentication session';
  END IF;

  UPDATE nova.person_status_periods
  SET ended_at = v_transition_at
  WHERE person_id = v_person_id AND ended_at IS NULL;

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (v_person_id, 'frozen', v_transition_at);

  IF nova.can_create_auth_session('better-auth-subject-frozen-person') THEN
    RAISE EXCEPTION 'frozen person could create an authentication session';
  END IF;

  IF nova.can_create_auth_session('unknown-post-bootstrap-subject') THEN
    RAISE EXCEPTION 'unmapped account could create an authentication session after bootstrap';
  END IF;
END;
$$;

ROLLBACK;
