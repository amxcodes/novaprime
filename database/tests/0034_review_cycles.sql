-- Proves decided review cycles are immutable. Always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA review cycle test', 'review-cycle@example.test', 'Review Cycle', 'review-cycle-subject');
DO $$
DECLARE a uuid; reviewer uuid; o uuid; w uuid; t uuid; assignment_id uuid; cycle_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO a, o FROM nova.resolve_authenticated_actor('review-cycle-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  INSERT INTO nova.people (organisation_id, email, display_name) VALUES (o, 'reviewer@example.test', 'Reviewer') RETURNING id INTO reviewer;
  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id) VALUES (o, 'Review Workstream', a) RETURNING id INTO w;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id) VALUES (o, w, 'Review task', a) RETURNING id INTO t;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, reviewer_person_id, assigned_by_person_id) VALUES (o, t, a, true, reviewer, a) RETURNING id INTO assignment_id;
  INSERT INTO nova.task_review_cycles (organisation_id, assignment_id, cycle_number, reviewer_person_id, decision, decided_at) VALUES (o, assignment_id, 1, reviewer, 'approved', clock_timestamp()) RETURNING id INTO cycle_id;
  BEGIN
    UPDATE nova.task_review_cycles SET feedback = 'tampered' WHERE id = cycle_id;
    RAISE EXCEPTION 'decided review was mutable';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;
