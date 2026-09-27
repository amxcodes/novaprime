-- Proves historical timeline adjustments are auditable and cannot overlap
-- timer-backed work or another adjustment. Always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA timeline adjustment test', 'timeline-adjustment@example.test', 'Timeline Adjustment', 'timeline-adjustment-subject');
DO $$
DECLARE
  a uuid; o uuid; w uuid; t uuid; assignment_id uuid; adjustment_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO a, o
  FROM nova.resolve_authenticated_actor('timeline-adjustment-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (o, 'Timeline Workstream', a) RETURNING id INTO w;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (o, w, 'Timeline task', a) RETURNING id INTO t;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, assigned_by_person_id)
  VALUES (o, t, a, false, a) RETURNING id INTO assignment_id;
  INSERT INTO nova.work_timeline_adjustments (
    organisation_id, person_id, assignment_id, started_at, ended_at, reason, created_by_person_id
  ) VALUES (o, a, assignment_id, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '90 minutes', 'Forgot timer', a)
  RETURNING id INTO adjustment_id;
  IF adjustment_id IS NULL THEN RAISE EXCEPTION 'adjustment was not created'; END IF;
  BEGIN
    INSERT INTO nova.work_timeline_adjustments (
      organisation_id, person_id, assignment_id, started_at, ended_at, reason, created_by_person_id
    ) VALUES (o, a, assignment_id, clock_timestamp() - interval '110 minutes', clock_timestamp() - interval '80 minutes', 'Overlap', a);
    RAISE EXCEPTION 'overlapping adjustment was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  INSERT INTO nova.work_sessions (organisation_id, assignment_id, person_id, started_at, ended_at, state)
  VALUES (o, assignment_id, a, clock_timestamp() - interval '60 minutes', clock_timestamp() - interval '30 minutes', 'completed');
  BEGIN
    INSERT INTO nova.work_timeline_adjustments (
      organisation_id, person_id, assignment_id, started_at, ended_at, reason, created_by_person_id
    ) VALUES (o, a, assignment_id, clock_timestamp() - interval '45 minutes', clock_timestamp() - interval '15 minutes', 'Timer overlap', a);
    RAISE EXCEPTION 'timer-overlapping adjustment was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;
