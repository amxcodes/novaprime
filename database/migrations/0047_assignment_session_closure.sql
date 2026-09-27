-- Canonical assignment-scoped work-session closure for task cancellation and
-- reassignment. Lifecycle callers must not calculate or write closure state
-- independently.

CREATE FUNCTION nova.close_assignment_work_sessions(
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
  UPDATE nova.work_sessions
  SET ended_at = GREATEST(p_effective_at, started_at + interval '1 microsecond'),
      state = 'auto_closed',
      closure_reason = left(COALESCE(p_reason, 'LIFECYCLE_CHANGE'), 120)
  WHERE assignment_id = p_assignment_id
    AND ended_at IS NULL;

  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.close_assignment_work_sessions(uuid, timestamptz, text) FROM PUBLIC;
