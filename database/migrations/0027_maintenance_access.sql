-- Explicit maintenance access for the portable scheduled worker. The function
-- is SECURITY DEFINER and only purges expired location evidence; normal API
-- requests still cannot read or bypass attendance RLS.
REVOKE ALL ON FUNCTION nova.purge_expired_attendance_location_evidence(integer) FROM PUBLIC;
