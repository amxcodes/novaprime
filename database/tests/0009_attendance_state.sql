-- Proves one attendance state per person/business date, safe time bounds,
-- organisation scoping, and the explicit mode-change permission. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA attendance test',
  'attendance-admin@example.test',
  'Attendance Admin',
  'better-auth-subject-attendance-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_attendance_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-attendance-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'attendance.change_mode'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost attendance mode-change authority';
  END IF;

  INSERT INTO nova.offices (organisation_id, name, location, timezone)
  VALUES (v_organisation_id, 'Attendance Office', 'Test', 'Asia/Kolkata')
  RETURNING id INTO v_office_id;

  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at
  ) VALUES (
    v_organisation_id, v_actor_id, v_office_id, '2026-09-19', 'office',
    '2026-09-19 04:00:00+00'
  ) RETURNING id INTO v_attendance_id;

  UPDATE nova.attendance_days
  SET mode = 'wfh', mode_changed_at = '2026-09-19 04:30:00+00',
      checked_out_at = '2026-09-19 12:00:00+00'
  WHERE id = v_attendance_id;

  IF NOT EXISTS (
    SELECT 1 FROM nova.attendance_days
    WHERE id = v_attendance_id
      AND mode = 'wfh'
      AND checked_out_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'attendance state did not retain its mode and checkout';
  END IF;

  BEGIN
    INSERT INTO nova.attendance_days (
      organisation_id, person_id, office_id, business_date, mode, checked_in_at
    ) VALUES (
      v_organisation_id, v_actor_id, v_office_id, '2026-09-19', 'office',
      '2026-09-19 05:00:00+00'
    );
    RAISE EXCEPTION 'duplicate person/business-date attendance was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO nova.attendance_days (
      organisation_id, person_id, office_id, business_date, mode,
      checked_in_at, checked_out_at
    ) VALUES (
      v_organisation_id, v_actor_id, v_office_id, '2026-09-20', 'office',
      '2026-09-20 12:00:00+00', '2026-09-20 11:00:00+00'
    );
    RAISE EXCEPTION 'checkout before check-in was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
