-- Exercise office-local 23/25-hour days and exact one-microsecond closure.
-- Test-only fixture; always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA timezone boundary test',
  'timezone-boundary-admin@example.test',
  'Timezone Boundary Admin',
  'better-auth-subject-timezone-boundary'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_workstream_id uuid;
  v_task_id uuid;
  v_assignment_id uuid;
  v_attendance_id uuid;
  v_session_id uuid;
  v_new_office_id uuid;
  v_timezone text;
  v_business_date date;
  v_expected_seconds integer;
  v_day_start timestamptz;
  v_boundary timestamptz;
  v_started_at timestamptz;
  v_closed integer;
  v_actual timestamptz;
  v_reason text;
  v_state nova.work_session_state;
  v_index integer;
  v_timezones text[] := ARRAY['America/New_York', 'America/Los_Angeles', 'Asia/Kolkata'];
  v_dates date[] := ARRAY[DATE '2025-03-09', DATE '2025-11-02', DATE '2025-12-03'];
  v_day_seconds integer[] := ARRAY[82800, 90000, 86400];
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-timezone-boundary');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Timezone Boundary Workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, created_by_person_id)
  VALUES (v_organisation_id, v_workstream_id, 'Timezone Boundary Task', v_actor_id)
  RETURNING id INTO v_task_id;
  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, assigned_by_person_id
  ) VALUES (v_organisation_id, v_task_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;

  FOR v_index IN 1..array_length(v_timezones, 1) LOOP
    v_timezone := v_timezones[v_index];
    v_business_date := v_dates[v_index];
    v_expected_seconds := v_day_seconds[v_index];

    INSERT INTO nova.offices (organisation_id, name, timezone)
    VALUES (v_organisation_id, 'Boundary Office ' || v_index, v_timezone)
    RETURNING id INTO v_office_id;
    INSERT INTO nova.person_office_assignments (
      person_id, office_id, effective_on, effective_until
    ) VALUES (
      v_actor_id, v_office_id,
      CASE v_index WHEN 1 THEN DATE '2020-01-01' WHEN 2 THEN DATE '2025-06-02' ELSE DATE '2025-12-01' END,
      CASE v_index WHEN 1 THEN DATE '2025-06-01' WHEN 2 THEN DATE '2025-11-30' ELSE NULL END
    );

    v_day_start := v_business_date::timestamp AT TIME ZONE v_timezone;
    v_boundary := (v_business_date + 1)::timestamp AT TIME ZONE v_timezone;
    IF EXTRACT(EPOCH FROM (v_boundary - v_day_start)) <> v_expected_seconds THEN
      RAISE EXCEPTION 'unexpected local-day length for % on %: % seconds',
        v_timezone, v_business_date, EXTRACT(EPOCH FROM (v_boundary - v_day_start));
    END IF;

    v_started_at := (v_business_date + time '23:59:59.999999') AT TIME ZONE v_timezone;
    IF v_boundary - v_started_at <> interval '1 microsecond' THEN
      RAISE EXCEPTION 'boundary is not exactly one microsecond after local-day final instant for %', v_timezone;
    END IF;

    INSERT INTO nova.attendance_days (
      organisation_id, person_id, office_id, business_date, mode, checked_in_at
    ) VALUES (
      v_organisation_id, v_actor_id, v_office_id, v_business_date, 'office', v_started_at
    ) RETURNING id INTO v_attendance_id;
    SELECT nova.close_attendance_at_business_boundary(10) INTO v_closed;
    IF v_closed <> 1 THEN
      RAISE EXCEPTION 'attendance boundary did not close for %', v_timezone;
    END IF;
    SELECT checked_out_at, closure_reason INTO v_actual, v_reason
    FROM nova.attendance_days WHERE id = v_attendance_id;
    IF v_actual <> v_boundary OR v_actual - v_started_at <> interval '1 microsecond'
      OR v_reason <> 'BUSINESS_DATE_BOUNDARY' THEN
      RAISE EXCEPTION 'attendance closure lost local boundary precision for %', v_timezone;
    END IF;

    INSERT INTO nova.work_sessions (
      organisation_id, assignment_id, person_id, office_id, started_at
    ) VALUES (
      v_organisation_id, v_assignment_id, v_actor_id, v_office_id, v_started_at
    ) RETURNING id INTO v_session_id;
    SELECT nova.close_work_sessions_at_business_boundary(10) INTO v_closed;
    IF v_closed <> 1 THEN
      RAISE EXCEPTION 'work-session boundary did not close for %', v_timezone;
    END IF;
    SELECT ended_at, state INTO v_actual, v_state
    FROM nova.work_sessions WHERE id = v_session_id;
    IF v_actual <> v_boundary OR v_actual - v_started_at <> interval '1 microsecond'
      OR v_state <> 'auto_closed' THEN
      RAISE EXCEPTION 'work-session closure lost local boundary precision for %', v_timezone;
    END IF;

    IF nova.close_attendance_at_business_boundary(10) <> 0
      OR nova.close_work_sessions_at_business_boundary(10) <> 0 THEN
      RAISE EXCEPTION 'repeated boundary tick was not idempotent for %', v_timezone;
    END IF;
  END LOOP;

  -- An office transfer after time is recorded must not move either record's
  -- already-established business-day boundary to the new office timezone.
  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Transferred Office', 'America/Los_Angeles')
  RETURNING id INTO v_new_office_id;
  UPDATE nova.person_office_assignments
  SET effective_until = CURRENT_DATE - 1
  WHERE person_id = v_actor_id AND effective_until IS NULL;
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (v_actor_id, v_new_office_id, CURRENT_DATE);

  v_timezone := 'Asia/Kolkata';
  v_business_date := (clock_timestamp() AT TIME ZONE v_timezone)::date - 2;
  v_boundary := (v_business_date + 1)::timestamp AT TIME ZONE v_timezone;
  v_started_at := (v_business_date + time '23:59:59.999999') AT TIME ZONE v_timezone;

  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at
  ) VALUES (
    v_organisation_id, v_actor_id, v_office_id, v_business_date, 'office', v_started_at
  ) RETURNING id INTO v_attendance_id;
  INSERT INTO nova.work_sessions (
    organisation_id, assignment_id, person_id, office_id, started_at
  ) VALUES (
    v_organisation_id, v_assignment_id, v_actor_id, v_office_id, v_started_at
  ) RETURNING id INTO v_session_id;

  IF nova.close_attendance_at_business_boundary(10) <> 1 THEN
    RAISE EXCEPTION 'attendance transfer fixture did not close';
  END IF;
  SELECT checked_out_at, closure_reason INTO v_actual, v_reason
  FROM nova.attendance_days WHERE id = v_attendance_id;
  IF v_actual <> v_boundary OR v_reason <> 'BUSINESS_DATE_BOUNDARY' THEN
    RAISE EXCEPTION 'attendance transfer used the new office boundary';
  END IF;

  IF nova.close_work_sessions_at_business_boundary(10) <> 1 THEN
    RAISE EXCEPTION 'work-session transfer fixture did not close';
  END IF;
  SELECT ended_at, state INTO v_actual, v_state
  FROM nova.work_sessions WHERE id = v_session_id;
  IF v_actual <> v_boundary OR v_state <> 'auto_closed' THEN
    RAISE EXCEPTION 'work-session transfer used the new office boundary';
  END IF;
END;
$$;

ROLLBACK;
