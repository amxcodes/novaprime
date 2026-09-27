-- Proves the portable collaboration context is organisation-safe and supports
-- client/workstream/group/task assignment flows. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA collaboration test',
  'collaboration-admin@example.test',
  'Collaboration Admin',
  'better-auth-subject-collaboration-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_employee_id uuid;
  v_organisation_id uuid;
  v_client_id uuid;
  v_client_workstream_id uuid;
  v_group_id uuid;
  v_task_id uuid;
  v_assignment_id uuid;
  v_role_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-collaboration-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'collaboration-employee@example.test', 'Collaboration Employee')
  RETURNING id INTO v_employee_id;

  INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Acme Client', v_actor_id)
  RETURNING id INTO v_client_id;

  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Delivery', v_actor_id)
  RETURNING id INTO v_client_workstream_id;
  UPDATE nova.client_workstreams
  SET billing_policy_class = 'non_billable'
  WHERE id = v_client_workstream_id;

  INSERT INTO nova.work_groups (organisation_id, client_workstream_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_workstream_id, 'Backend', v_actor_id)
  RETURNING id INTO v_group_id;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, work_group_id, title, created_by_person_id
  ) VALUES (
    v_organisation_id, v_client_workstream_id, v_group_id, 'Ship API', v_actor_id
  ) RETURNING id INTO v_task_id;

  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, reviewer_person_id, assigned_by_person_id
  ) VALUES (
    v_organisation_id, v_task_id, v_employee_id, v_actor_id, v_actor_id
  ) RETURNING id INTO v_assignment_id;

  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'task assignment was not created';
  END IF;

  INSERT INTO nova.role_permission_grants (
    role_id, permission_key, scope, client_id
  )
  SELECT roles.id, 'clients.view', 'client'::nova.permission_scope, v_client_id
  FROM nova.roles roles
  WHERE roles.organisation_id = v_organisation_id AND roles.key = 'super_admin'
  RETURNING role_id INTO v_role_id;

  IF v_role_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM nova.role_permission_grants
    WHERE role_id = v_role_id AND permission_key = 'clients.view' AND client_id = v_client_id
  ) THEN
    RAISE EXCEPTION 'client-scoped role grant was not created';
  END IF;

  BEGIN
    INSERT INTO nova.task_assignments (
      organisation_id, task_id, person_id, reviewer_person_id, assigned_by_person_id
    ) VALUES (
      v_organisation_id, v_task_id, v_employee_id, v_employee_id, v_actor_id
    );
    RAISE EXCEPTION 'self-review assignment was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
