-- The selected first-run attendance policy is durable, effective-dated and
-- lifecycle closure ends an open attendance row without deleting history.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA attendance policy test',
  'attendance-policy@example.test',
  'Attendance Policy',
  'attendance-policy-subject',
  'scheduled'::nova.attendance_policy_mode,
  510
);

DO $$
DECLARE
  v_organisation_id uuid;
  v_person_id uuid;
  v_office_id uuid;
  v_attendance_id uuid;
  v_mode nova.attendance_policy_mode;
  v_required integer;
  v_closed integer;
BEGIN
  SELECT user_id, organisation_id
    INTO v_person_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('attendance-policy-subject');
  -- RLS represents a normal authenticated request, so establish the
  -- provider-neutral actor context before exercising the attendance writes.
  PERFORM set_config('nova.user_id', v_person_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  SELECT mode, required_attendance_minutes
    INTO v_mode, v_required
  FROM nova.organisation_attendance_policies
  WHERE organisation_id = v_organisation_id
    AND effective_on = current_date;
  IF v_mode <> 'scheduled' OR v_required <> 510 THEN
    RAISE EXCEPTION 'ATTENDANCE_POLICY_BOOTSTRAP_NOT_PERSISTED';
  END IF;

  INSERT INTO nova.offices (
    organisation_id, name, location, timezone, latitude, longitude,
    attendance_geofence_radius_meters
  ) VALUES (
    v_organisation_id, 'Policy Office', 'Policy Office', 'UTC',
    0, 0, 100
  ) RETURNING id INTO v_office_id;

  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at
  ) VALUES (
    v_organisation_id, v_person_id, v_office_id, current_date, 'office',
    clock_timestamp() - interval '1 hour'
  ) RETURNING id INTO v_attendance_id;

  SELECT nova.close_person_attendance(v_person_id, clock_timestamp()) INTO v_closed;
  IF v_closed <> 1 OR NOT EXISTS (
    SELECT 1 FROM nova.attendance_days
    WHERE id = v_attendance_id AND checked_out_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_LIFECYCLE_CLOSE_FAILED';
  END IF;
END;
$$;

ROLLBACK;
