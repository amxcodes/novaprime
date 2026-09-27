-- Proves pending WFH evidence is not attendance, a required timer is linked to
-- open evidence, and the timer must close before evidence can be checked out.
-- Test-only fixture; always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA provisional WFH test',
  'provisional-wfh-admin@example.test',
  'Provisional WFH Admin',
  'better-auth-subject-provisional-wfh'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_workstream_id uuid;
  v_task_id uuid;
  v_assignment_id uuid;
  v_request_id uuid;
  v_evidence_id uuid;
  v_session_id uuid;
  v_timezone text := 'America/New_York';
  v_business_date date := DATE '2026-03-08';
  v_boundary timestamptz;
  v_closed_count integer;
  v_error text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-provisional-wfh');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  v_boundary := (v_business_date + 1)::timestamp AT TIME ZONE v_timezone;

  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Provisional WFH Office', v_timezone)
  RETURNING id INTO v_office_id;
  INSERT INTO nova.wfh_requests (
    organisation_id, person_id, start_date, end_date, reason
  ) VALUES (
    v_organisation_id, v_actor_id, v_business_date, v_business_date, 'Provisional evidence fixture'
  ) RETURNING id INTO v_request_id;
  INSERT INTO nova.wfh_provisional_attendance (
    organisation_id, request_id, person_id, office_id,
    office_timezone_snapshot, business_date, checked_in_at
  ) VALUES (
    v_organisation_id, v_request_id, v_actor_id, v_office_id,
    v_timezone, v_business_date, v_boundary - interval '2 hours'
  ) RETURNING id INTO v_evidence_id;

  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Provisional WFH Workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (v_organisation_id, v_workstream_id, 'Provisional WFH Task', v_actor_id)
  RETURNING id INTO v_task_id;
  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, assigned_by_person_id
  ) VALUES (v_organisation_id, v_task_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;
  INSERT INTO nova.work_sessions (
    organisation_id, assignment_id, person_id, office_id,
    office_timezone_snapshot, provisional_wfh_attendance_id, started_at
  ) VALUES (
    v_organisation_id, v_assignment_id, v_actor_id, v_office_id,
    v_timezone, v_evidence_id, v_boundary - interval '1 hour'
  ) RETURNING id INTO v_session_id;

  IF EXISTS (
    SELECT 1 FROM nova.attendance_days
    WHERE person_id = v_actor_id AND business_date = v_business_date
  ) THEN
    RAISE EXCEPTION 'pending WFH evidence entered the authoritative attendance ledger';
  END IF;

  BEGIN
    UPDATE nova.wfh_provisional_attendance
    SET checked_out_at = clock_timestamp()
    WHERE id = v_evidence_id;
    RAISE EXCEPTION 'provisional evidence closed before its linked timer';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'WFH_PROVISIONAL_TIMER_MUST_CLOSE_FIRST' THEN RAISE; END IF;
  END;

  SELECT nova.close_wfh_provisional_attendance_at_business_boundary(1)
  INTO v_closed_count;
  IF v_closed_count <> 1 THEN
    RAISE EXCEPTION 'first provisional WFH business-boundary tick closed % rows', v_closed_count;
  END IF;
  SELECT nova.close_wfh_provisional_attendance_at_business_boundary(1)
  INTO v_closed_count;
  IF v_closed_count <> 0 THEN
    RAISE EXCEPTION 'repeated provisional WFH business-boundary tick was not idempotent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM nova.work_sessions
    WHERE id = v_session_id AND ended_at = v_boundary
      AND closure_reason = 'WFH_PROVISIONAL_BUSINESS_BOUNDARY'
  ) OR NOT EXISTS (
    SELECT 1 FROM nova.wfh_provisional_attendance
    WHERE id = v_evidence_id AND status = 'pending'
      AND checked_out_at = v_boundary AND resolved_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM nova.attendance_days
    WHERE person_id = v_actor_id AND business_date = v_business_date
  ) THEN
    RAISE EXCEPTION 'provisional WFH close lost timer/evidence boundary or created attendance';
  END IF;

  UPDATE nova.wfh_provisional_attendance
  SET status = 'discarded', resolved_at = v_boundary,
      resolution_reason = 'WFH_REQUEST_REJECTED'
  WHERE id = v_evidence_id;
END;
$$;

ROLLBACK;
