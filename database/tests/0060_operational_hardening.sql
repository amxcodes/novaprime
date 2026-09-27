-- Proves the operational-hardening migration's portable database boundaries.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA operational hardening test',
  'operational-hardening-admin@example.test',
  'Operational Hardening Admin',
  'better-auth-subject-operational-hardening'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_office_id uuid;
  v_shift_id uuid;
  v_key_count integer;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-operational-hardening');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT nova.is_valid_timezone('Asia/Kolkata') OR nova.is_valid_timezone('Not/A_Timezone') THEN
    RAISE EXCEPTION 'timezone validation is not portable';
  END IF;

  INSERT INTO nova.offices (organisation_id, name, timezone)
  VALUES (v_organisation_id, 'Overnight Office', 'Asia/Kolkata')
  RETURNING id INTO v_office_id;

  INSERT INTO nova.shifts (
    organisation_id, name, start_local_time, end_local_time, spans_midnight
  ) VALUES (
    v_organisation_id, 'Overnight', '22:00', '06:00', true
  ) RETURNING id INTO v_shift_id;

  IF NOT (SELECT spans_midnight FROM nova.shifts WHERE id = v_shift_id) THEN
    RAISE EXCEPTION 'overnight shift flag was not retained';
  END IF;

  BEGIN
    INSERT INTO nova.shifts (
      organisation_id, name, start_local_time, end_local_time,
      break_start_local_time, break_end_local_time, spans_midnight
    ) VALUES (
      v_organisation_id, 'Overnight break', '22:00', '06:00',
      '01:00', '01:30', true
    );
    RAISE EXCEPTION 'overnight break was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO nova.api_idempotency_keys (
    organisation_id, actor_person_id, command, idempotency_key,
    request_hash, response_status, response_body
  ) VALUES (
    v_organisation_id, v_actor_id, 'test', 'hardening-key', repeat('a', 64),
    201, '{"ok":true}'::jsonb
  );
  SELECT count(*) INTO v_key_count
  FROM nova.api_idempotency_keys
  WHERE organisation_id = v_organisation_id AND actor_person_id = v_actor_id
    AND command = 'test' AND idempotency_key = 'hardening-key';
  IF v_key_count <> 1 THEN RAISE EXCEPTION 'idempotency row was not retained'; END IF;
END;
$$;

ROLLBACK;
