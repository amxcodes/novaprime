-- Pending WFH may collect non-authoritative evidence while task work continues.
-- Approval promotes it into the sole attendance ledger; rejection discards only
-- attendance credit and closes timers that were allowed by that evidence.

ALTER TABLE nova.wfh_requests
  ADD CONSTRAINT wfh_requests_organisation_id_pair UNIQUE (organisation_id, id);

ALTER TABLE nova.attendance_days
  ADD CONSTRAINT attendance_days_organisation_id_pair UNIQUE (organisation_id, id),
  ADD COLUMN office_timezone_snapshot text;

UPDATE nova.attendance_days attendance
SET office_timezone_snapshot = offices.timezone
FROM nova.offices offices
WHERE offices.id = attendance.office_id;

ALTER TABLE nova.work_sessions
  ADD COLUMN office_timezone_snapshot text,
  ADD COLUMN provisional_wfh_attendance_id uuid;

UPDATE nova.work_sessions sessions
SET office_timezone_snapshot = offices.timezone
FROM nova.offices offices
WHERE offices.id = sessions.office_id;

CREATE TYPE nova.wfh_provisional_attendance_status AS ENUM ('pending', 'promoted', 'discarded');

CREATE TABLE nova.wfh_provisional_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  request_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES nova.people(id),
  office_id uuid NOT NULL REFERENCES nova.offices(id),
  office_timezone_snapshot text NOT NULL,
  business_date date NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checked_out_at timestamptz,
  status nova.wfh_provisional_attendance_status NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  attendance_day_id uuid,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (checked_out_at IS NULL OR checked_out_at > checked_in_at),
  CHECK (
    (status = 'pending' AND resolved_at IS NULL AND attendance_day_id IS NULL AND resolution_reason IS NULL)
    OR (status = 'promoted' AND resolved_at IS NOT NULL AND attendance_day_id IS NOT NULL AND resolution_reason IS NULL)
    OR (status = 'discarded' AND resolved_at IS NOT NULL AND attendance_day_id IS NULL AND resolution_reason IS NOT NULL)
  ),
  UNIQUE (organisation_id, id),
  UNIQUE (request_id, business_date),
  FOREIGN KEY (organisation_id, request_id)
    REFERENCES nova.wfh_requests (organisation_id, id),
  FOREIGN KEY (organisation_id, attendance_day_id)
    REFERENCES nova.attendance_days (organisation_id, id)
);

CREATE UNIQUE INDEX wfh_provisional_one_pending_person_day
  ON nova.wfh_provisional_attendance (person_id, business_date)
  WHERE status = 'pending';

CREATE INDEX wfh_provisional_request_status
  ON nova.wfh_provisional_attendance (request_id, status, business_date);

ALTER TABLE nova.work_sessions
  ADD CONSTRAINT work_sessions_provisional_wfh_fk
    FOREIGN KEY (organisation_id, provisional_wfh_attendance_id)
    REFERENCES nova.wfh_provisional_attendance (organisation_id, id);

CREATE FUNCTION nova.validate_wfh_provisional_attendance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  request_row record;
  office_row record;
BEGIN
  SELECT organisation_id, person_id, start_date, end_date, status
  INTO request_row
  FROM nova.wfh_requests
  WHERE id = NEW.request_id
  FOR KEY SHARE;

  SELECT organisation_id, timezone
  INTO office_row
  FROM nova.offices
  WHERE id = NEW.office_id
  FOR KEY SHARE;

  IF request_row.organisation_id IS DISTINCT FROM NEW.organisation_id
     OR request_row.person_id IS DISTINCT FROM NEW.person_id
     OR NEW.business_date NOT BETWEEN request_row.start_date AND request_row.end_date
     OR office_row.organisation_id IS DISTINCT FROM NEW.organisation_id
     OR office_row.timezone IS DISTINCT FROM NEW.office_timezone_snapshot
     OR (TG_OP = 'INSERT' AND request_row.status <> 'pending') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WFH_PROVISIONAL_ATTENDANCE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wfh_provisional_attendance_validate
BEFORE INSERT OR UPDATE OF organisation_id, request_id, person_id, office_id,
  office_timezone_snapshot, business_date
ON nova.wfh_provisional_attendance
FOR EACH ROW EXECUTE FUNCTION nova.validate_wfh_provisional_attendance();

CREATE FUNCTION nova.validate_work_session_provisional_wfh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  evidence record;
BEGIN
  IF NEW.provisional_wfh_attendance_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organisation_id, person_id, status, checked_out_at
  INTO evidence
  FROM nova.wfh_provisional_attendance
  WHERE id = NEW.provisional_wfh_attendance_id
  FOR KEY SHARE;

  IF evidence.organisation_id IS DISTINCT FROM NEW.organisation_id
     OR evidence.person_id IS DISTINCT FROM NEW.person_id
     OR evidence.status <> 'pending'
     OR evidence.checked_out_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_SESSION_PROVISIONAL_WFH_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_sessions_validate_provisional_wfh
BEFORE INSERT OR UPDATE OF provisional_wfh_attendance_id ON nova.work_sessions
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_session_provisional_wfh();

CREATE FUNCTION nova.guard_wfh_provisional_attendance_closure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF (NEW.status = 'discarded'
      OR (OLD.checked_out_at IS NULL AND NEW.checked_out_at IS NOT NULL))
     AND EXISTS (
       SELECT 1 FROM nova.work_sessions sessions
       WHERE sessions.provisional_wfh_attendance_id = OLD.id
         AND sessions.ended_at IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WFH_PROVISIONAL_TIMER_MUST_CLOSE_FIRST';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wfh_provisional_attendance_guard_closure
BEFORE UPDATE OF status, checked_out_at ON nova.wfh_provisional_attendance
FOR EACH ROW EXECUTE FUNCTION nova.guard_wfh_provisional_attendance_closure();

ALTER TABLE nova.wfh_provisional_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY wfh_provisional_attendance_request_organisation
ON nova.wfh_provisional_attendance
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE OR REPLACE FUNCTION nova.close_person_work_sessions(
  p_person_id uuid,
  p_ended_at timestamptz,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  UPDATE nova.work_sessions sessions
  SET ended_at = GREATEST(
        LEAST(
          p_ended_at,
          COALESCE(
            ((sessions.started_at AT TIME ZONE sessions.office_timezone_snapshot)::date + 1)::timestamp
              AT TIME ZONE sessions.office_timezone_snapshot,
            p_ended_at
          )
        ),
        sessions.started_at + interval '1 microsecond'
      ),
      state = 'auto_closed',
      closure_reason = left(COALESCE(p_reason, 'LIFECYCLE_CHANGE'), 120)
  WHERE sessions.person_id = p_person_id AND sessions.ended_at IS NULL;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

CREATE OR REPLACE FUNCTION nova.close_assignment_work_sessions(
  p_assignment_id uuid,
  p_effective_at timestamptz,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  UPDATE nova.work_sessions sessions
  SET ended_at = GREATEST(
        LEAST(
          p_effective_at,
          COALESCE(
            ((sessions.started_at AT TIME ZONE sessions.office_timezone_snapshot)::date + 1)::timestamp
              AT TIME ZONE sessions.office_timezone_snapshot,
            p_effective_at
          )
        ),
        sessions.started_at + interval '1 microsecond'
      ),
      state = 'auto_closed',
      closure_reason = left(COALESCE(p_reason, 'LIFECYCLE_CHANGE'), 120)
  WHERE sessions.assignment_id = p_assignment_id AND sessions.ended_at IS NULL;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
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
  UPDATE nova.work_sessions sessions
  SET ended_at = GREATEST(
        LEAST(
          p_effective_at,
          COALESCE(
            ((sessions.started_at AT TIME ZONE sessions.office_timezone_snapshot)::date + 1)::timestamp
              AT TIME ZONE sessions.office_timezone_snapshot,
            p_effective_at
          )
        ),
        sessions.started_at + interval '1 microsecond'
      ),
      state = 'auto_closed',
      closure_reason = 'WFH_PROVISIONAL_PERSON_CLOSED'
  WHERE sessions.person_id = p_person_id
    AND sessions.provisional_wfh_attendance_id IS NOT NULL
    AND sessions.ended_at IS NULL;

  UPDATE nova.wfh_provisional_attendance evidence
  SET checked_out_at = COALESCE(
        evidence.checked_out_at,
        GREATEST(
          LEAST(
            p_effective_at,
            ((evidence.business_date + 1)::timestamp AT TIME ZONE evidence.office_timezone_snapshot)
          ),
          evidence.checked_in_at + interval '1 microsecond'
        )
      ),
      status = 'discarded',
      resolved_at = p_effective_at,
      resolution_reason = 'PERSON_LIFECYCLE_CHANGE'
  WHERE evidence.person_id = p_person_id AND evidence.status = 'pending';

  UPDATE nova.attendance_days attendance
  SET checked_out_at = GREATEST(
        LEAST(
          p_effective_at,
          ((attendance.business_date + 1)::timestamp
            AT TIME ZONE COALESCE(attendance.office_timezone_snapshot, offices.timezone))
        ),
        attendance.checked_in_at + interval '1 microsecond'
      ),
      closure_reason = 'LIFECYCLE_CHANGE'
  FROM nova.offices offices
  WHERE offices.id = attendance.office_id
    AND attendance.person_id = p_person_id
    AND attendance.checked_out_at IS NULL
    AND attendance.checked_in_at <= p_effective_at;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

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
      ((attendance.business_date + 1)::timestamp
        AT TIME ZONE COALESCE(attendance.office_timezone_snapshot, offices.timezone)) AS boundary_at
    FROM nova.attendance_days attendance
    JOIN nova.offices offices ON offices.id = attendance.office_id
    WHERE attendance.checked_out_at IS NULL
      AND ((attendance.business_date + 1)::timestamp
        AT TIME ZONE COALESCE(attendance.office_timezone_snapshot, offices.timezone)) <= clock_timestamp()
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
      ((sessions.started_at AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone))::date + 1)::timestamp
        AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone) AS boundary_at
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
    LEFT JOIN nova.offices offices ON offices.id = COALESCE(sessions.office_id, fallback.office_id)
    WHERE sessions.ended_at IS NULL
      AND COALESCE(sessions.office_timezone_snapshot, offices.timezone) IS NOT NULL
      AND ((sessions.started_at AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone))::date + 1)::timestamp
        AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone) <= clock_timestamp()
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

CREATE FUNCTION nova.close_wfh_provisional_attendance_at_business_boundary(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  candidate record;
  evidence record;
  boundary_at timestamptz;
  closed_count integer := 0;
BEGIN
  FOR candidate IN
    SELECT id, person_id, business_date
    FROM nova.wfh_provisional_attendance
    WHERE status = 'pending' AND checked_out_at IS NULL
      AND ((business_date + 1)::timestamp AT TIME ZONE office_timezone_snapshot) <= clock_timestamp()
    ORDER BY business_date, checked_in_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
  LOOP
    -- Match API availability-lock order: person/date lock before row locks.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(candidate.person_id::text || ':' || candidate.business_date::text, 0)
    );
    SELECT id, organisation_id, person_id, business_date, office_timezone_snapshot, checked_in_at
    INTO evidence
    FROM nova.wfh_provisional_attendance
    WHERE id = candidate.id AND status = 'pending' AND checked_out_at IS NULL
      AND ((business_date + 1)::timestamp AT TIME ZONE office_timezone_snapshot) <= clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    boundary_at := (evidence.business_date + 1)::timestamp AT TIME ZONE evidence.office_timezone_snapshot;
    UPDATE nova.work_sessions sessions
    SET ended_at = GREATEST(
          LEAST(
            boundary_at,
            COALESCE(
              ((sessions.started_at AT TIME ZONE sessions.office_timezone_snapshot)::date + 1)::timestamp
                AT TIME ZONE sessions.office_timezone_snapshot,
              boundary_at
            )
          ),
          sessions.started_at + interval '1 microsecond'
        ),
        state = 'auto_closed', closure_reason = 'WFH_PROVISIONAL_BUSINESS_BOUNDARY'
    WHERE sessions.provisional_wfh_attendance_id = evidence.id AND sessions.ended_at IS NULL;

    UPDATE nova.wfh_provisional_attendance
    SET checked_out_at = GREATEST(boundary_at, evidence.checked_in_at + interval '1 microsecond')
    WHERE id = evidence.id AND status = 'pending' AND checked_out_at IS NULL;

    INSERT INTO nova.audit_events (
      organisation_id, actor_person_id, action, target_type, target_id, details
    ) VALUES (
      evidence.organisation_id, NULL, 'attendance.provisional_auto_closed',
      'wfh_provisional_attendance', evidence.id,
      jsonb_build_object('person_id', evidence.person_id,
        'business_date', evidence.business_date,
        'checked_out_at', boundary_at,
        'reason', 'BUSINESS_DATE_BOUNDARY')
    );
    closed_count := closed_count + 1;
  END LOOP;
  RETURN closed_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.close_wfh_provisional_attendance_at_business_boundary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nova.close_wfh_provisional_attendance_at_business_boundary(integer) TO nova_app;
