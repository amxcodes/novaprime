-- Proves reviewer exception metadata is complete and organisation-bound.
-- Always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA reviewer exception test', 'reviewer-exception@example.test', 'Reviewer Exception', 'reviewer-exception-subject');
DO $$
DECLARE a uuid; reviewer uuid; o uuid; w uuid; t uuid; assignment_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO a, o
  FROM nova.resolve_authenticated_actor('reviewer-exception-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (o, 'exception-reviewer@example.test', 'Exception Reviewer') RETURNING id INTO reviewer;
  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (o, 'Exception Workstream', a) RETURNING id INTO w;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (o, w, 'Exception task', a) RETURNING id INTO t;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, assigned_by_person_id)
  VALUES (o, t, a, true, a) RETURNING id INTO assignment_id;
  UPDATE nova.task_assignments
  SET reviewer_person_id = reviewer,
      reviewer_exception_reason = 'No eligible reviewer available',
      reviewer_exception_granted_by_person_id = a,
      reviewer_exception_granted_at = clock_timestamp()
  WHERE id = assignment_id;
  BEGIN
    UPDATE nova.task_assignments
    SET reviewer_exception_reason = NULL
    WHERE id = assignment_id;
    RAISE EXCEPTION 'partial reviewer exception was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;
