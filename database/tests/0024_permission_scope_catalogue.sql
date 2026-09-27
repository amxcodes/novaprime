-- Proves a permission cannot be granted with a scope its command contract
-- does not support. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA permission scope test',
  'permission-scope-admin@example.test',
  'Permission Scope Admin',
  'better-auth-subject-permission-scope-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_role_id uuid;
  v_office_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-permission-scope-admin');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  SELECT id INTO v_role_id FROM nova.roles
  WHERE organisation_id = v_organisation_id AND key = 'super_admin';
  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Scope Office', 'UTC') RETURNING id INTO v_office_id;

  BEGIN
    INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, office_id)
    VALUES (v_role_id, 'tasks.start', 'office', v_office_id);
    RAISE EXCEPTION 'unsupported permission scope was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
  VALUES (v_role_id, 'tasks.start', 'assigned_work');
END;
$$;

ROLLBACK;
