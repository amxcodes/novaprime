-- Proves an audited check-in timestamp correction refreshes evidence expiry.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA location expiry fix test',
  'location-expiry-fix-admin@example.test',
  'Location Expiry Fix Admin',
  'better-auth-subject-location-expiry-fix-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_expiry timestamptz;
  v_updated_expiry timestamptz;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-location-expiry-fix-admin');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Expiry Office', 'Asia/Kolkata') RETURNING id INTO v_office_id;
  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at,
    check_in_latitude, check_in_longitude, check_in_accuracy_meters, check_in_distance_meters
  ) VALUES (
    v_organisation_id, v_actor_id, v_office_id, '2026-09-19', 'office',
    '2026-09-19 04:00:00+00', 9.9312, 76.2673, 10, 2
  ) RETURNING location_evidence_expires_at INTO v_expiry;
  UPDATE nova.attendance_days
  SET checked_in_at = '2026-09-20 04:00:00+00'
  WHERE person_id = v_actor_id AND business_date = '2026-09-19';
  SELECT location_evidence_expires_at INTO v_updated_expiry
  FROM nova.attendance_days WHERE person_id = v_actor_id AND business_date = '2026-09-19';
  IF v_updated_expiry <= v_expiry THEN
    RAISE EXCEPTION 'location evidence expiry was not refreshed';
  END IF;
END;
$$;

ROLLBACK;
