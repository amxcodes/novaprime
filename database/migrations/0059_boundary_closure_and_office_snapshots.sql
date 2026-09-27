-- NOVA Phase 5: portable business-boundary closure.
-- Attendance and productive work use the office that governed the record at
-- start time, so a later office transfer cannot change historical duration.

ALTER TABLE nova.attendance_days
  ADD COLUMN IF NOT EXISTS closure_reason text;

UPDATE nova.attendance_days
SET closure_reason = COALESCE(closure_reason, 'LEGACY_CHECKOUT')
WHERE checked_out_at IS NOT NULL;

ALTER TABLE nova.work_sessions
  ADD COLUMN IF NOT EXISTS office_id uuid REFERENCES nova.offices(id);

CREATE INDEX IF NOT EXISTS work_sessions_office_time
  ON nova.work_sessions (office_id, started_at)
  WHERE ended_at IS NULL;

-- Backfill legacy sessions from the office assignment that governed their
-- start date. Rows without an assignment remain nullable and are handled by
-- the boundary function's current-assignment fallback.
UPDATE nova.work_sessions sessions
SET office_id = source.office_id
FROM (
  SELECT DISTINCT ON (sessions.id)
    sessions.id,
    assignments.office_id
  FROM nova.work_sessions sessions
  JOIN nova.person_office_assignments assignments
    ON assignments.person_id = sessions.person_id
  JOIN nova.offices offices ON offices.id = assignments.office_id
  WHERE sessions.office_id IS NULL
    AND assignments.effective_on <= (sessions.started_at AT TIME ZONE offices.timezone)::date
    AND (assignments.effective_until IS NULL
      OR assignments.effective_until >= (sessions.started_at AT TIME ZONE offices.timezone)::date)
  ORDER BY sessions.id, assignments.effective_on DESC
) source
WHERE sessions.id = source.id;

CREATE OR REPLACE FUNCTION nova.validate_work_session_organisation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  assignment_organisation_id uuid;
  assignment_person_id uuid;
  office_organisation_id uuid;
BEGIN
  SELECT organisation_id, person_id
  INTO assignment_organisation_id, assignment_person_id
  FROM nova.task_assignments
  WHERE id = NEW.assignment_id;
  IF assignment_organisation_id IS DISTINCT FROM NEW.organisation_id
    OR assignment_person_id IS DISTINCT FROM NEW.person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_SESSION_ASSIGNMENT_MISMATCH';
  END IF;
  IF NEW.office_id IS NOT NULL THEN
    SELECT organisation_id INTO office_organisation_id
    FROM nova.offices WHERE id = NEW.office_id;
    IF office_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_SESSION_OFFICE_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nova.close_person_attendance(
  p_person_id uuid,
  p_effective_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  UPDATE nova.attendance_days
  SET checked_out_at = GREATEST(p_effective_at, checked_in_at + interval '1 microsecond'),
      closure_reason = 'LIFECYCLE_CHANGE'
  WHERE person_id = p_person_id
    AND checked_out_at IS NULL
    AND checked_in_at <= p_effective_at;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

-- Close open attendance records at the first office-local midnight after the
-- recorded business date. The operation is idempotent and safe to run from
-- multiple schedulers because rows are locked with SKIP LOCKED.
CREATE OR REPLACE FUNCTION nova.close_attendance_at_business_boundary(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  WITH candidates AS (
    SELECT attendance.id,
      ((attendance.business_date + 1)::timestamp AT TIME ZONE offices.timezone) AS boundary_at
    FROM nova.attendance_days attendance
    JOIN nova.offices offices ON offices.id = attendance.office_id
    WHERE attendance.checked_out_at IS NULL
      AND ((attendance.business_date + 1)::timestamp AT TIME ZONE offices.timezone) <= clock_timestamp()
    ORDER BY attendance.checked_in_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
    FOR UPDATE OF attendance SKIP LOCKED
  ), closed AS (
    UPDATE nova.attendance_days attendance
    SET checked_out_at = GREATEST(candidates.boundary_at, attendance.checked_in_at + interval '1 microsecond'),
        closure_reason = 'BUSINESS_DATE_BOUNDARY'
    FROM candidates
    WHERE attendance.id = candidates.id
    RETURNING attendance.id, attendance.organisation_id, attendance.person_id,
      attendance.business_date, attendance.checked_out_at
  )
  INSERT INTO nova.audit_events (
    organisation_id, actor_person_id, action, target_type, target_id, details
  )
  SELECT closed.organisation_id, NULL, 'attendance.auto_closed', 'attendance_day',
    closed.id, jsonb_build_object(
      'person_id', closed.person_id,
      'business_date', closed.business_date,
      'checked_out_at', closed.checked_out_at,
      'reason', 'BUSINESS_DATE_BOUNDARY'
    )
  FROM closed;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

-- Close a session at the first midnight after it started, using its office
-- snapshot. Legacy rows use the effective office assignment as a fallback.
CREATE OR REPLACE FUNCTION nova.close_work_sessions_at_business_boundary(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  WITH candidates AS (
    SELECT sessions.id,
      ((sessions.started_at AT TIME ZONE offices.timezone)::date + 1)::timestamp
        AT TIME ZONE offices.timezone AS boundary_at
    FROM nova.work_sessions sessions
    LEFT JOIN LATERAL (
      SELECT assignments.office_id
      FROM nova.person_office_assignments assignments
      JOIN nova.offices assigned_offices ON assigned_offices.id = assignments.office_id
      WHERE sessions.office_id IS NULL
        AND assignments.person_id = sessions.person_id
        AND assignments.effective_on <= (sessions.started_at AT TIME ZONE assigned_offices.timezone)::date
        AND (assignments.effective_until IS NULL
          OR assignments.effective_until >= (sessions.started_at AT TIME ZONE assigned_offices.timezone)::date)
      ORDER BY assignments.effective_on DESC
      LIMIT 1
    ) fallback ON true
    JOIN nova.offices offices ON offices.id = COALESCE(sessions.office_id, fallback.office_id)
    WHERE sessions.ended_at IS NULL
      AND ((sessions.started_at AT TIME ZONE offices.timezone)::date + 1)::timestamp
        AT TIME ZONE offices.timezone <= clock_timestamp()
    ORDER BY sessions.started_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
    FOR UPDATE OF sessions SKIP LOCKED
  )
  UPDATE nova.work_sessions sessions
  SET ended_at = GREATEST(candidates.boundary_at, sessions.started_at + interval '1 microsecond'),
      state = 'auto_closed', closure_reason = 'BUSINESS_DATE_BOUNDARY'
  FROM candidates
  WHERE sessions.id = candidates.id;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.close_attendance_at_business_boundary(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.close_person_attendance(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.close_work_sessions_at_business_boundary(integer) FROM PUBLIC;
