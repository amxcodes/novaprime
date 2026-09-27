-- Proves the portable provider-configuration boundary, invitation identity
-- claim, verification transition, and Super Admin RLS gate. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA email delivery test',
  'email-admin@example.test',
  'Email Admin',
  'better-auth-subject-email-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_invited_person_id uuid;
  v_token_hash bytea := decode(repeat('ab', 32), 'hex');
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-email-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT nova.request_actor_is_super_admin() THEN
    RAISE EXCEPTION 'bootstrap Super Admin lost system email authority';
  END IF;

  INSERT INTO nova.email_provider_connections (name, provider, sender_email)
  VALUES ('Local console', 'console', 'noreply@example.test');

  UPDATE nova.email_provider_connections
  SET last_tested_at = now(), is_active = true
  WHERE name = 'Local console';

  IF NOT EXISTS (SELECT 1 FROM nova.active_email_provider_connection()) THEN
    RAISE EXCEPTION 'active email provider could not be resolved';
  END IF;

  PERFORM set_config('nova.user_id', '11111111-1111-4111-8111-111111111111', true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  IF (SELECT count(*) FROM nova.email_provider_connections) <> 0 THEN
    RAISE EXCEPTION 'non-Super-Admin could read email provider configuration';
  END IF;

  PERFORM set_config('nova.user_id', v_actor_id::text, true);

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'invited-person@example.test', 'Invited Person')
  RETURNING id INTO v_invited_person_id;

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (v_invited_person_id, 'invited', now());

  INSERT INTO nova.person_invitations (
    person_id, invitee_email, token_hash, expires_at
  ) VALUES (
    v_invited_person_id,
    'invited-person@example.test',
    v_token_hash,
    now() + interval '7 days'
  );

  INSERT INTO nova_auth."user" (
    id, name, email, "emailVerified", "createdAt", "updatedAt"
  ) VALUES (
    'better-auth-subject-invited-person',
    'Invited Person',
    'invited-person@example.test',
    false,
    now(),
    now()
  );

  IF NOT nova.claim_invitation_identity(
    'better-auth-subject-invited-person',
    'invited-person@example.test',
    v_token_hash
  ) THEN
    RAISE EXCEPTION 'valid invitation could not claim Better Auth identity';
  END IF;

  UPDATE nova_auth."user"
  SET "emailVerified" = true
  WHERE id = 'better-auth-subject-invited-person';

  IF NOT nova.complete_invitation_after_email_verification(
    'better-auth-subject-invited-person'
  ) THEN
    RAISE EXCEPTION 'verified invitation did not transition into onboarding';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM nova.person_status_periods
    WHERE person_id = v_invited_person_id
      AND status = 'onboarding'
      AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'verified invitee is not in onboarding';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM nova.person_invitations
    WHERE person_id = v_invited_person_id
      AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'verified invitation was not accepted';
  END IF;
END;
$$;

ROLLBACK;
