-- Proves attendance recovery preserves an immutable correction trail and can
-- create a missing attendance day from an effective office assignment.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA attendance recovery test',
  'attendance-recovery-admin@example.test',
  'Attendance Recovery Admin',
  'better-auth-subject-attendance-recovery-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_employee_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_attendance_id uuid;
  v_correction_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-attendance-recovery-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'attendance-recovery-employee@example.test', 'Attendance Recovery Employee')
  RETURNING id INTO v_employee_id;

  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Recovery Office', 'Asia/Kolkata')
  RETURNING id INTO v_office_id;

  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (v_employee_id, v_office_id, '2026-01-01');

  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at
  ) VALUES (
    v_organisation_id, v_employee_id, v_office_id, '2026-09-18', 'office',
    '2026-09-18 04:00:00+00'
  ) RETURNING id INTO v_attendance_id;

  INSERT INTO nova.attendance_corrections (
    organisation_id, person_id, attendance_day_id, business_date,
    before_state, after_state, reason, corrected_by_person_id
  ) VALUES (
    v_organisation_id, v_employee_id, v_attendance_id, '2026-09-18',
    '{"checkedOutAt":null}'::jsonb,
    '{"checkedOutAt":"2026-09-18T12:00:00Z"}'::jsonb,
    'Device failed to submit checkout', v_actor_id
  ) RETURNING id INTO v_correction_id;

  IF NOT EXISTS (
    SELECT 1 FROM nova.attendance_corrections
    WHERE id = v_correction_id AND attendance_day_id = v_attendance_id
  ) THEN
    RAISE EXCEPTION 'attendance correction was not recorded';
  END IF;
END;
$$;

ROLLBACK;
