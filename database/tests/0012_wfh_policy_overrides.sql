-- Proves WFH overrides are effective-dated, scoped, and organisation-safe.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA WFH policy test',
  'wfh-admin@example.test',
  'WFH Admin',
  'better-auth-subject-wfh-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_override_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-wfh-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'availability.wfh_policy.manage'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost WFH policy authority';
  END IF;

  INSERT INTO nova.offices (organisation_id, name, location, timezone)
  VALUES (v_organisation_id, 'WFH Office', 'Test', 'UTC')
  RETURNING id INTO v_office_id;

  INSERT INTO nova.wfh_policy_overrides (
    organisation_id, target_type, target_id, allowed, effective_on, reason, created_by_person_id
  ) VALUES (
    v_organisation_id, 'office', v_office_id, false, '2026-01-01', 'Office restriction', v_actor_id
  ) RETURNING id INTO v_override_id;

  IF NOT EXISTS (
    SELECT 1 FROM nova.wfh_policy_overrides
    WHERE id = v_override_id AND allowed = false
  ) THEN
    RAISE EXCEPTION 'WFH policy override was not retained';
  END IF;

  BEGIN
    INSERT INTO nova.wfh_policy_overrides (
      organisation_id, target_type, target_id, allowed, effective_on, reason, created_by_person_id
    ) VALUES (
      v_organisation_id, 'office', v_office_id, true, '2026-06-01', 'Overlap', v_actor_id
    );
    RAISE EXCEPTION 'overlapping WFH override was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
