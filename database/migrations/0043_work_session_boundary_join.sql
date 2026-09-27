-- Correct the portable maintenance closure query so the office alias is
-- available before it is used in effective-dated assignment predicates.

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
      (
        date_trunc('day', clock_timestamp() AT TIME ZONE offices.timezone)
        AT TIME ZONE offices.timezone
      ) AS boundary_at
    FROM nova.work_sessions sessions
    JOIN nova.person_office_assignments assignments
      ON assignments.person_id = sessions.person_id
    JOIN nova.offices offices
      ON offices.id = assignments.office_id
     AND assignments.effective_on <= (clock_timestamp() AT TIME ZONE offices.timezone)::date
     AND (assignments.effective_until IS NULL OR assignments.effective_until >= (clock_timestamp() AT TIME ZONE offices.timezone)::date)
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
