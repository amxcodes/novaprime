-- Proves leave portions, organisation checks, overlap protection, and lifecycle.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA leave test',
  'leave-admin@example.test',
  'Leave Admin',
  'better-auth-subject-leave-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_request_id uuid;
  v_overlap_request_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-leave-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM nova.role_permission_grants grants
    JOIN nova.person_role_assignments assignments ON assignments.role_id = grants.role_id
    WHERE assignments.person_id = v_actor_id
      AND grants.permission_key = 'leave.review'
  ) THEN
    RAISE EXCEPTION 'Super Admin lost leave review authority';
  END IF;

  INSERT INTO nova.leave_requests (
    organisation_id, person_id, leave_type, start_date, end_date, reason
  ) VALUES (
    v_organisation_id, v_actor_id, 'annual', '2026-09-21', '2026-09-22', 'Rest'
  ) RETURNING id INTO v_request_id;

  INSERT INTO nova.leave_request_days (
    organisation_id, request_id, person_id, business_date, portion
  ) VALUES
    (v_organisation_id, v_request_id, v_actor_id, '2026-09-21', 1.0),
    (v_organisation_id, v_request_id, v_actor_id, '2026-09-22', 0.5);

  UPDATE nova.leave_requests
  SET status = 'approved', reviewer_person_id = v_actor_id, reviewed_at = clock_timestamp()
  WHERE id = v_request_id;

  IF (SELECT status FROM nova.leave_requests WHERE id = v_request_id) <> 'approved'::nova.leave_request_status
     OR (SELECT count(*) FROM nova.leave_request_days WHERE request_id = v_request_id) <> 2 THEN
    RAISE EXCEPTION 'leave request lifecycle or days were not retained';
  END IF;

  BEGIN
    INSERT INTO nova.leave_requests (
      organisation_id, person_id, leave_type, start_date, end_date
    ) VALUES (
      v_organisation_id, v_actor_id, 'sick', '2026-09-22', '2026-09-22'
    ) RETURNING id INTO v_overlap_request_id;
    INSERT INTO nova.leave_request_days (
      organisation_id, request_id, person_id, business_date, portion
    ) VALUES (v_organisation_id, v_overlap_request_id, v_actor_id, '2026-09-22', 1.0);
    RAISE EXCEPTION 'overlapping leave request was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO nova.leave_request_days (
      organisation_id, request_id, person_id, business_date, portion
    ) VALUES (v_organisation_id, v_request_id, v_actor_id, '2026-09-23', 0.25);
    RAISE EXCEPTION 'invalid leave portion was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
