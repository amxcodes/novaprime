-- Location evidence is a check-in decision signal, not continuous tracking.
-- Keep the minimum evidence needed for disputes for 90 days by default, then
-- allow a narrowly scoped operator job to remove only the evidence columns.

ALTER TABLE nova.attendance_days
  ADD COLUMN location_evidence_expires_at timestamptz;

UPDATE nova.attendance_days
SET location_evidence_expires_at = checked_in_at + interval '90 days'
WHERE check_in_latitude IS NOT NULL;

CREATE FUNCTION nova.set_location_evidence_expiry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.check_in_latitude IS NULL THEN
    NEW.location_evidence_expires_at := NULL;
  ELSIF NEW.location_evidence_expires_at IS NULL
        OR (TG_OP = 'UPDATE' AND (
          NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
          OR
          NEW.check_in_latitude IS DISTINCT FROM OLD.check_in_latitude
          OR NEW.check_in_longitude IS DISTINCT FROM OLD.check_in_longitude
          OR NEW.check_in_accuracy_meters IS DISTINCT FROM OLD.check_in_accuracy_meters
          OR NEW.check_in_distance_meters IS DISTINCT FROM OLD.check_in_distance_meters
        )) THEN
    NEW.location_evidence_expires_at := NEW.checked_in_at + interval '90 days';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_days_location_evidence_expiry
BEFORE INSERT OR UPDATE OF checked_in_at, check_in_latitude,
  check_in_longitude, check_in_accuracy_meters, check_in_distance_meters
ON nova.attendance_days
FOR EACH ROW EXECUTE FUNCTION nova.set_location_evidence_expiry();

CREATE FUNCTION nova.purge_expired_attendance_location_evidence(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 10000);
  v_count integer;
BEGIN
  WITH expired AS (
    SELECT id
    FROM nova.attendance_days
    WHERE location_evidence_expires_at IS NOT NULL
      AND location_evidence_expires_at <= clock_timestamp()
    ORDER BY location_evidence_expires_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE nova.attendance_days attendance
  SET check_in_latitude = NULL,
      check_in_longitude = NULL,
      check_in_accuracy_meters = NULL,
      check_in_distance_meters = NULL,
      location_evidence_expires_at = NULL
  FROM expired
  WHERE attendance.id = expired.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.purge_expired_attendance_location_evidence(integer) FROM PUBLIC;
