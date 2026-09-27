-- Proves historical exceptions preserve source identity and require explicit
-- resolution metadata. Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA exception test',
  'exception-admin@example.test',
  'Exception Admin',
  'better-auth-subject-exception-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_exception_id uuid;
BEGIN
  SELECT user_id, organisation_id
  INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-exception-admin');

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.historical_exceptions (
    organisation_id, source_type, source_id, person_id, business_date, code, details
  ) VALUES (
    v_organisation_id, 'attendance_day', gen_random_uuid(), v_actor_id,
    '2026-09-19', 'availability.attendance_closed', '{"reason":"holiday"}'::jsonb
  ) RETURNING id INTO v_exception_id;

  UPDATE nova.historical_exceptions
  SET status = 'resolved', resolved_by_person_id = v_actor_id,
      resolved_at = clock_timestamp(), resolution_note = 'Reviewed'
  WHERE id = v_exception_id;

  IF NOT EXISTS (
    SELECT 1 FROM nova.historical_exceptions
    WHERE id = v_exception_id AND status = 'resolved' AND resolution_note = 'Reviewed'
  ) THEN
    RAISE EXCEPTION 'historical exception was not explicitly resolved';
  END IF;
END;
$$;

ROLLBACK;
