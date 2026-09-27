BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA task create client scope test', 'task-create-client-scope@example.test', 'Task Create Scope', 'task-create-client-scope-subject');
DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  allowed nova.permission_scope[];
BEGIN
  SELECT resolved.user_id, resolved.organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('task-create-client-scope-subject') AS resolved;
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  SELECT permissions.allowed_scopes INTO allowed
  FROM nova.permissions
  WHERE permissions.key = 'tasks.create';
  IF allowed IS DISTINCT FROM ARRAY['organisation', 'client', 'client_workstream', 'group']::nova.permission_scope[] THEN
    RAISE EXCEPTION 'tasks.create scope catalogue is not client-capable';
  END IF;
END;
$$;
ROLLBACK;
