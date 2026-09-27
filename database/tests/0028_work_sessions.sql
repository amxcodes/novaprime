-- Proves work-session overlap is database-enforced. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA work session test',
  'work-session-admin@example.test',
  'Work Session Admin',
  'better-auth-subject-work-session'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_workstream_id uuid;
  v_task_id uuid;
  v_assignment_id uuid;
  v_session_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-work-session');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Session Workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (v_organisation_id, v_workstream_id, 'Session test', v_actor_id) RETURNING id INTO v_task_id;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, assigned_by_person_id)
  VALUES (v_organisation_id, v_task_id, v_actor_id, false, v_actor_id) RETURNING id INTO v_assignment_id;
  INSERT INTO nova.work_sessions (organisation_id, assignment_id, person_id, started_at, ended_at, state)
  VALUES (v_organisation_id, v_assignment_id, v_actor_id, clock_timestamp() - interval '1 hour', clock_timestamp(), 'completed')
  RETURNING id INTO v_session_id;
  BEGIN
    INSERT INTO nova.work_sessions (organisation_id, assignment_id, person_id, started_at)
    VALUES (v_organisation_id, v_assignment_id, v_actor_id, clock_timestamp() - interval '30 minutes');
    RAISE EXCEPTION 'overlapping work session was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
