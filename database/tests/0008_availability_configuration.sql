-- Proves the Phase 2 configuration entities are organisation-scoped, constrained,
-- and available through the non-owner application role. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA availability test',
  'availability-admin@example.test',
  'Availability Admin',
  'better-auth-subject-availability-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_shift_id uuid;
  v_calendar_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-availability-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'availability.calendar.manage'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost availability configuration authority';
  END IF;

  INSERT INTO nova.offices (organisation_id, name, location, timezone)
  VALUES (v_organisation_id, 'Availability Office', 'Test', 'Asia/Kolkata')
  RETURNING id INTO v_office_id;

  INSERT INTO nova.shifts (
    organisation_id, name, start_local_time, end_local_time,
    break_start_local_time, break_end_local_time, grace_minutes
  ) VALUES (
    v_organisation_id, 'Standard', '09:30', '18:30', '13:00', '14:00', 10
  ) RETURNING id INTO v_shift_id;

  INSERT INTO nova.working_calendars (organisation_id, name)
  VALUES (v_organisation_id, 'Office calendar')
  RETURNING id INTO v_calendar_id;

  INSERT INTO nova.working_calendar_rules (
    calendar_id, weekday, ordinal, is_working, shift_id
  ) VALUES
    (v_calendar_id, 1, 0, true, v_shift_id),
    (v_calendar_id, 2, 0, true, v_shift_id),
    (v_calendar_id, 3, 0, true, v_shift_id),
    (v_calendar_id, 4, 0, true, v_shift_id),
    (v_calendar_id, 5, 0, true, v_shift_id),
    (v_calendar_id, 6, 0, false, NULL),
    (v_calendar_id, 0, 0, false, NULL),
    (v_calendar_id, 6, 3, true, v_shift_id);

  INSERT INTO nova.office_calendar_assignments (office_id, calendar_id, effective_on)
  VALUES (v_office_id, v_calendar_id, '2026-01-01');

  INSERT INTO nova.office_holidays (
    organisation_id, office_id, holiday_date, name, created_by_person_id
  ) VALUES (
    v_organisation_id, v_office_id, '2026-08-15', 'Test holiday', v_actor_id
  );

  IF (SELECT count(*) FROM nova.working_calendar_rules WHERE calendar_id = v_calendar_id) <> 8 THEN
    RAISE EXCEPTION 'calendar rules were not retained';
  END IF;

  BEGIN
    INSERT INTO nova.shifts (organisation_id, name, start_local_time, end_local_time)
    VALUES (v_organisation_id, 'Invalid', '18:00', '09:00');
    RAISE EXCEPTION 'reverse shift was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO nova.working_calendar_rules (calendar_id, weekday, is_working, shift_id)
    VALUES (v_calendar_id, 1, true, NULL);
    RAISE EXCEPTION 'working rule without a shift was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO nova.office_calendar_assignments (office_id, calendar_id, effective_on)
    VALUES (v_office_id, v_calendar_id, '2026-06-01');
    RAISE EXCEPTION 'overlapping calendar assignment was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO nova.office_holidays (
      organisation_id, office_id, holiday_date, name, created_by_person_id
    ) VALUES (
      v_organisation_id, v_office_id, '2026-08-15', 'Duplicate holiday', v_actor_id
    );
    RAISE EXCEPTION 'duplicate office holiday was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
