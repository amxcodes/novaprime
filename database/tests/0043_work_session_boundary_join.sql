-- Proves the office-local maintenance closure query resolves its office alias
-- before evaluating effective-dated assignment predicates. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA work boundary test',
  'work-boundary-admin@example.test',
  'Work Boundary Admin',
  'better-auth-subject-work-boundary'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_workstream_id uuid;
  v_task_id uuid;
  v_assignment_id uuid;
  v_session_id uuid;
  v_closed integer;
  v_state nova.work_session_state;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-work-boundary');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Boundary Office', 'UTC')
  RETURNING id INTO v_office_id;
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (v_actor_id, v_office_id, current_date - 3);
  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Boundary Workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (v_organisation_id, v_workstream_id, 'Boundary test', v_actor_id)
  RETURNING id INTO v_task_id;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, assigned_by_person_id)
  VALUES (v_organisation_id, v_task_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;
  INSERT INTO nova.work_sessions (
    organisation_id, assignment_id, person_id, started_at
  ) VALUES (
    v_organisation_id, v_assignment_id, v_actor_id, clock_timestamp() - interval '2 days'
  ) RETURNING id INTO v_session_id;

  SELECT nova.close_work_sessions_at_business_boundary(10) INTO v_closed;
  IF v_closed <> 1 THEN
    RAISE EXCEPTION 'expected one session to close, got %', v_closed;
  END IF;
  SELECT state INTO v_state FROM nova.work_sessions WHERE id = v_session_id;
  IF v_state <> 'auto_closed' THEN
    RAISE EXCEPTION 'boundary session was not auto-closed';
  END IF;
END;
$$;

ROLLBACK;
