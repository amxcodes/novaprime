-- Proves WFH approval, overlap protection and office geofence evidence shape.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA WFH approval test',
  'wfh-approval-admin@example.test',
  'WFH Approval Admin',
  'better-auth-subject-wfh-approval-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_employee_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_request_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-wfh-approval-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'wfh-approval-employee@example.test', 'WFH Approval Employee')
  RETURNING id INTO v_employee_id;

  IF NOT EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'availability.wfh.review'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost WFH review authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'availability.office_geofence.manage'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost office geofence authority';
  END IF;

  INSERT INTO nova.offices (
    organisation_id, name, location, timezone, latitude, longitude,
    attendance_geofence_radius_meters
  ) VALUES (
    v_organisation_id, 'WFH Approval Office', 'Test', 'Asia/Kolkata',
    9.9312, 76.2673, 150
  ) RETURNING id INTO v_office_id;

  INSERT INTO nova.wfh_requests (
    organisation_id, person_id, start_date, end_date, reason
  ) VALUES (
    v_organisation_id, v_employee_id, '2026-09-21', '2026-09-22', 'Approved home work'
  ) RETURNING id INTO v_request_id;

  UPDATE nova.wfh_requests
  SET status = 'approved', reviewer_person_id = v_actor_id,
      reviewed_at = clock_timestamp(), review_reason = 'Reviewed'
  WHERE id = v_request_id;

  IF NOT EXISTS (
    SELECT 1 FROM nova.wfh_requests
    WHERE id = v_request_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'WFH request was not approved';
  END IF;

  BEGIN
    INSERT INTO nova.wfh_requests (
      organisation_id, person_id, start_date, end_date, reason
    ) VALUES (
      v_organisation_id, v_employee_id, '2026-09-22', '2026-09-23', 'Overlap'
    );
    RAISE EXCEPTION 'overlapping WFH request was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  INSERT INTO nova.attendance_days (
    organisation_id, person_id, office_id, business_date, mode, checked_in_at,
    check_in_latitude, check_in_longitude, check_in_accuracy_meters,
    check_in_distance_meters
  ) VALUES (
    v_organisation_id, v_actor_id, v_office_id, '2026-09-24', 'office',
    '2026-09-24 04:00:00+00', 9.9312, 76.2673, 12.5, 0
  );

  BEGIN
    INSERT INTO nova.wfh_requests (
      organisation_id, person_id, start_date, end_date, status,
      reviewer_person_id, reviewed_at
    ) VALUES (
      v_organisation_id, v_employee_id, '2026-09-25', '2026-09-25', 'approved',
      v_employee_id, clock_timestamp()
    );
    RAISE EXCEPTION 'self-approved WFH request was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
