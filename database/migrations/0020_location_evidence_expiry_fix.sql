-- Keep the 90-day expiry aligned when an audited recovery changes the
-- authoritative check-in timestamp while preserving location evidence.
CREATE OR REPLACE FUNCTION nova.set_location_evidence_expiry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.check_in_latitude IS NULL THEN
    NEW.location_evidence_expires_at := NULL;
  ELSIF NEW.location_evidence_expires_at IS NULL
        OR (TG_OP = 'UPDATE' AND (
          NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
          OR NEW.check_in_latitude IS DISTINCT FROM OLD.check_in_latitude
          OR NEW.check_in_longitude IS DISTINCT FROM OLD.check_in_longitude
          OR NEW.check_in_accuracy_meters IS DISTINCT FROM OLD.check_in_accuracy_meters
          OR NEW.check_in_distance_meters IS DISTINCT FROM OLD.check_in_distance_meters
        )) THEN
    NEW.location_evidence_expires_at := NEW.checked_in_at + interval '90 days';
  END IF;
  RETURN NEW;
END;
$$;
