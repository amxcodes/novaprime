-- NOVA Phase 4 first vertical slice: authoritative productive work sessions.
-- Sessions are append-only time segments; pause/resume creates new rows.

CREATE TYPE nova.work_session_state AS ENUM ('running', 'completed', 'auto_closed', 'cancelled');

CREATE TABLE nova.work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  assignment_id uuid NOT NULL REFERENCES nova.task_assignments(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  state nova.work_session_state NOT NULL DEFAULT 'running',
  closure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ended_at IS NULL OR ended_at > started_at),
  CHECK ((state = 'running' AND ended_at IS NULL) OR (state <> 'running' AND ended_at IS NOT NULL)),
  EXCLUDE USING gist (
    person_id WITH =,
    tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') WITH &&
  )
);

CREATE UNIQUE INDEX work_sessions_one_running_person
  ON nova.work_sessions (person_id) WHERE ended_at IS NULL;
CREATE INDEX work_sessions_assignment_time
  ON nova.work_sessions (assignment_id, started_at DESC);
CREATE INDEX work_sessions_person_time
  ON nova.work_sessions (person_id, started_at DESC);

CREATE FUNCTION nova.validate_work_session_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_organisation_id uuid;
  assignment_person_id uuid;
BEGIN
  SELECT organisation_id, person_id
  INTO assignment_organisation_id, assignment_person_id
  FROM nova.task_assignments
  WHERE id = NEW.assignment_id;
  IF assignment_organisation_id IS DISTINCT FROM NEW.organisation_id
    OR assignment_person_id IS DISTINCT FROM NEW.person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_SESSION_ASSIGNMENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_sessions_validate_organisation
BEFORE INSERT OR UPDATE ON nova.work_sessions
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_session_organisation();

CREATE FUNCTION nova.close_person_work_sessions(
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
  UPDATE nova.work_sessions
  SET ended_at = GREATEST(p_ended_at, started_at + interval '1 microsecond'),
      state = 'auto_closed',
      closure_reason = left(COALESCE(p_reason, 'LIFECYCLE_CHANGE'), 120)
  WHERE person_id = p_person_id AND ended_at IS NULL;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

CREATE FUNCTION nova.close_work_sessions_at_business_boundary(
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
      (
        date_trunc('day', clock_timestamp() AT TIME ZONE offices.timezone)
        AT TIME ZONE offices.timezone
      ) AS boundary_at
    FROM nova.work_sessions sessions
    JOIN nova.person_office_assignments assignments
      ON assignments.person_id = sessions.person_id
     AND assignments.effective_on <= (clock_timestamp() AT TIME ZONE offices.timezone)::date
     AND (assignments.effective_until IS NULL OR assignments.effective_until >= (clock_timestamp() AT TIME ZONE offices.timezone)::date)
    JOIN nova.offices offices ON offices.id = assignments.office_id
    WHERE sessions.ended_at IS NULL
      AND sessions.started_at < (
        date_trunc('day', clock_timestamp() AT TIME ZONE offices.timezone)
        AT TIME ZONE offices.timezone
      )
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

REVOKE ALL ON FUNCTION nova.close_person_work_sessions(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.close_work_sessions_at_business_boundary(integer) FROM PUBLIC;

ALTER TABLE nova.work_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_sessions_request_organisation ON nova.work_sessions
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
