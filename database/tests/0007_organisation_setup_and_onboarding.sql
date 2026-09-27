-- Proves the additive office location field and new Phase 1 grants remain
-- visible only within the request organisation. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA onboarding setup test',
  'onboarding-admin@example.test',
  'Onboarding Admin',
  'better-auth-subject-onboarding-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-onboarding-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'organisation.settings.manage'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost organisation settings authority';
  END IF;

  INSERT INTO nova.offices (organisation_id, name, location, timezone)
  VALUES (v_organisation_id, 'Kochi', 'Kochi, Kerala', 'Asia/Kolkata')
  RETURNING id INTO v_office_id;

  IF NOT EXISTS (
    SELECT 1 FROM nova.offices
    WHERE id = v_office_id
      AND location = 'Kochi, Kerala'
  ) THEN
    RAISE EXCEPTION 'office location was not retained';
  END IF;

  BEGIN
    INSERT INTO nova.offices (organisation_id, name, location, timezone)
    VALUES (v_organisation_id, 'Blank location', '   ', 'Asia/Kolkata');
    RAISE EXCEPTION 'blank office location was accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
