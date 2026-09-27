-- A return handover creates a fresh assignment without rewriting history,
-- while a person cannot hold two non-cancelled assignments for one task.
-- Test-only fixture; always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA assignment handover history test',
  'assignment-handover-history-admin@example.test',
  'Assignment Handover History Admin',
  'better-auth-subject-assignment-handover-history'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_workstream_id uuid;
  v_task_id uuid;
  v_count integer;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-assignment-handover-history');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Handover History Workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (v_organisation_id, v_workstream_id, 'Return handover history task', v_actor_id)
  RETURNING id INTO v_task_id;

  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, status, assigned_by_person_id
  ) VALUES (v_organisation_id, v_task_id, v_actor_id, false, 'cancelled', v_actor_id);
  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, status, assigned_by_person_id
  ) VALUES (v_organisation_id, v_task_id, v_actor_id, false, 'assigned', v_actor_id);

  BEGIN
    INSERT INTO nova.task_assignments (
      organisation_id, task_id, person_id, review_required, status, assigned_by_person_id
    ) VALUES (v_organisation_id, v_task_id, v_actor_id, false, 'in_progress', v_actor_id);
    RAISE EXCEPTION 'duplicate active assignment for the same task/person was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM nova.task_assignments
  WHERE task_id = v_task_id AND person_id = v_actor_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'expected the cancelled historical row and one active row, found %', v_count;
  END IF;
END;
$$;

ROLLBACK;
