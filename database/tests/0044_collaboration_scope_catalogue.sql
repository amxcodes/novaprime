-- Proves the collaboration scope catalogue accepts the targets used by the
-- API permission evaluator. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA collaboration scope test',
  'collaboration-scope-admin@example.test',
  'Collaboration Scope Admin',
  'better-auth-subject-collaboration-scope'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_role_id uuid;
  v_client_id uuid;
  v_workstream_id uuid;
  v_group_id uuid;
  v_organisation_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-collaboration-scope');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  SELECT id INTO v_role_id FROM nova.roles
  WHERE organisation_id = v_organisation_id AND key = 'super_admin';
  INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Scoped client', v_actor_id)
  RETURNING id INTO v_client_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Scoped workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.work_groups (organisation_id, client_workstream_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_workstream_id, 'Scoped group', v_actor_id)
  RETURNING id INTO v_group_id;

  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, client_id)
  VALUES (v_role_id, 'workstreams.view', 'client', v_client_id);
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, client_workstream_id)
  VALUES (v_role_id, 'workstreams.view', 'client_workstream', v_workstream_id);
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, client_workstream_id)
  VALUES (v_role_id, 'groups.view', 'client_workstream', v_workstream_id);
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, group_id)
  VALUES (v_role_id, 'groups.view', 'group', v_group_id);
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, client_workstream_id)
  VALUES (v_role_id, 'tasks.create', 'client_workstream', v_workstream_id);
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope, group_id)
  VALUES (v_role_id, 'tasks.reviewer_manage', 'group', v_group_id);
END;
$$;

ROLLBACK;
