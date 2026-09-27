-- Proves the role-command database boundary with the non-owner application role.
-- The transaction is always rolled back, leaving the target database fixture-free.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA roles command test',
  'roles-command@example.test',
  'Roles Command Test',
  'better-auth-subject-roles-command'
);

DO $$
DECLARE
  actor_id uuid;
  organisation_id uuid;
  role_id uuid;
BEGIN
  SELECT resolved.user_id, resolved.organisation_id
  INTO actor_id, organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-roles-command') AS resolved;

  IF actor_id IS NULL OR organisation_id IS NULL THEN
    RAISE EXCEPTION 'authenticated actor could not be resolved';
  END IF;

  PERFORM set_config('nova.user_id', actor_id::text, true);
  PERFORM set_config('nova.organisation_id', organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1
    FROM nova.person_role_assignments assignments
    JOIN nova.role_permission_grants grants ON grants.role_id = assignments.role_id
    WHERE assignments.person_id = actor_id
      AND assignments.effective_on <= current_date
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= current_date)
      AND grants.permission_key = 'roles.create'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'bootstrap Super Admin does not have roles.create';
  END IF;

  INSERT INTO nova.roles (organisation_id, key, name)
  VALUES (organisation_id, 'people_lead', 'People Lead')
  RETURNING id INTO role_id;

  INSERT INTO nova.role_operational_policies (role_id, work_enabled, wfh_allowed)
  VALUES (role_id, true, true);

  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
  VALUES (role_id, 'people.view', 'organisation');

  INSERT INTO nova.audit_events (
    organisation_id,
    actor_person_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    organisation_id,
    actor_id,
    'roles.create',
    'role',
    role_id,
    jsonb_build_object('key', 'people_lead')
  );

  IF NOT EXISTS (
    SELECT 1
    FROM nova.roles
    WHERE id = role_id AND key = 'people_lead'
  ) THEN
    RAISE EXCEPTION 'RLS context could not read the created custom role';
  END IF;
END;
$$;

ROLLBACK;
