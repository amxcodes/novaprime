-- Auth delivery fallback remains inside the NOVA domain: the database stores
-- encrypted handoff material, scopes it by organisation, and keeps one open
-- handoff per target/purpose.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA auth handoff test',
  'auth-handoff@example.test',
  'Auth Handoff',
  'auth-handoff-subject'
);

DO $$
DECLARE
  v_user_id uuid;
  v_organisation_id uuid;
BEGIN
  SELECT resolved.user_id, resolved.organisation_id
  INTO v_user_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('auth-handoff-subject') AS resolved;
  PERFORM set_config('nova.user_id', v_user_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
END;
$$;

DO $$
DECLARE
  v_first uuid;
  v_second uuid;
  v_open integer;
  v_revoked integer;
BEGIN
  SELECT nova.stage_auth_handoff(
    'auth-handoff-subject',
    'password_reset'::nova.auth_handoff_purpose,
    decode('010203', 'hex'),
    1::smallint,
    now() + interval '1 hour',
    'email_unavailable'
  ) INTO v_first;

  SELECT nova.stage_auth_handoff(
    'auth-handoff-subject',
    'password_reset'::nova.auth_handoff_purpose,
    decode('040506', 'hex'),
    1::smallint,
    now() + interval '1 hour',
    'email_unavailable'
  ) INTO v_second;

  SELECT count(*) INTO v_open
  FROM nova.auth_handoffs
  WHERE purpose = 'password_reset'
    AND revealed_at IS NULL
    AND revoked_at IS NULL;
  SELECT count(*) INTO v_revoked
  FROM nova.auth_handoffs
  WHERE id = v_first AND revoked_at IS NOT NULL;

  IF v_first IS NULL OR v_second IS NULL OR v_open <> 1 OR v_revoked <> 1 THEN
    RAISE EXCEPTION 'AUTH_HANDOFF_REPLACEMENT_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM nova.permissions
    WHERE key = 'auth.manual_recovery'
  ) THEN
    RAISE EXCEPTION 'AUTH_MANUAL_RECOVERY_PERMISSION_MISSING';
  END IF;
END;
$$;

ROLLBACK;
