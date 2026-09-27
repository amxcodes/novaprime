-- Proves the public-origin setting is RLS-scoped, permission-catalogued and
-- represented as an origin-only value. Always rollback.
BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA public origin test',
  'public-origin-admin@example.test',
  'Public Origin Admin',
  'better-auth-subject-public-origin-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-public-origin-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'organisation.public_origin.manage'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost public-origin authority';
  END IF;

  INSERT INTO nova.organisation_runtime_settings (organisation_id, public_origin, updated_by_person_id)
  VALUES (v_organisation_id, 'https://work.example.test', v_actor_id);

  IF nova.public_origin_for_organisation(v_organisation_id) <> 'https://work.example.test' THEN
    RAISE EXCEPTION 'Public origin resolver returned an unexpected value';
  END IF;

  BEGIN
    UPDATE nova.organisation_runtime_settings
    SET public_origin = 'https://work.example.test/path'
    WHERE organisation_id = v_organisation_id;
    RAISE EXCEPTION 'Origin path was accepted';
  EXCEPTION
  WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
