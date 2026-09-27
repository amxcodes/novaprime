-- Proves location evidence receives an expiry and can be removed without
-- touching attendance state. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA location evidence test',
  'location-evidence-admin@example.test',
  'Location Evidence Admin',
  'better-auth-subject-location-evidence-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_attendance_id uuid;
  v_expiry timestamptz;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-location-evidence-admin');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Evidence Office', 'Asia/Kolkata')
  RETURNING id INTO v_office_id;

  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at,
    check_in_latitude, check_in_longitude, check_in_accuracy_meters, check_in_distance_meters
  ) VALUES (
    v_organisation_id, v_actor_id, v_office_id, '2026-09-19', 'office',
    clock_timestamp(), 9.9312, 76.2673, 10, 2
  ) RETURNING id, location_evidence_expires_at INTO v_attendance_id, v_expiry;

  IF v_expiry IS NULL OR v_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'location evidence expiry was not assigned';
  END IF;

  UPDATE nova.attendance_days
  SET check_in_latitude = NULL, check_in_longitude = NULL,
      check_in_accuracy_meters = NULL, check_in_distance_meters = NULL
  WHERE id = v_attendance_id;

  IF EXISTS (
    SELECT 1 FROM nova.attendance_days
    WHERE id = v_attendance_id AND location_evidence_expires_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'location evidence expiry was not cleared with evidence';
  END IF;
END;
$$;

ROLLBACK;
