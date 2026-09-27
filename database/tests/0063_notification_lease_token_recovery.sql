-- A stale worker must not finish another worker's notification lease.
-- Test-only fixture; always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA notification lease test',
  'notification-lease-admin@example.test',
  'Notification Lease Admin',
  'better-auth-subject-notification-lease'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_notification_id uuid;
  v_outbox_id uuid;
  v_repeat_id uuid;
  v_lease_token uuid;
  v_attempts integer;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-notification-lease');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.notifications (
    organisation_id, recipient_person_id, event_key, title, body, idempotency_key
  ) VALUES (
    v_organisation_id, v_actor_id, 'task.assigned', 'Task assigned',
    'Lease ownership test', 'notification-lease-token-test'
  ) RETURNING id INTO v_notification_id;

  SELECT nova.stage_notification_outbox(
    v_organisation_id, v_notification_id, v_actor_id, 'task.assigned',
    '{"title":"Task assigned","body":"Lease ownership test"}'::jsonb
  ) INTO v_outbox_id;
  SELECT nova.stage_notification_outbox(
    v_organisation_id, v_notification_id, v_actor_id, 'task.assigned',
    '{"title":"Task assigned","body":"Lease ownership test"}'::jsonb
  ) INTO v_repeat_id;
  IF v_repeat_id IS DISTINCT FROM v_outbox_id THEN
    RAISE EXCEPTION 'notification outbox staging was not idempotent';
  END IF;

  SELECT id, lease_token, attempts
  INTO v_outbox_id, v_lease_token, v_attempts
  FROM nova.claim_notification_outbox(1, 120);
  IF v_outbox_id IS NULL OR v_lease_token IS NULL OR v_attempts <> 1 THEN
    RAISE EXCEPTION 'notification worker did not receive one identified lease';
  END IF;
  PERFORM set_config('nova.qa.outbox_id', v_outbox_id::text, true);
  PERFORM set_config('nova.qa.old_lease_token', v_lease_token::text, true);
END;
$$;

-- Simulate a worker crash after claiming. Only the expired lease is edited,
-- under the migration-test role; normal workers cannot mutate this queue.
RESET ROLE;
DO $$
BEGIN
  UPDATE nova.notification_outbox
  SET lease_until = clock_timestamp() - interval '1 second'
  WHERE id = current_setting('nova.qa.outbox_id')::uuid
    AND status = 'processing';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification lease fixture could not expire the first claim';
  END IF;
END;
$$;

SET LOCAL ROLE nova_app;
DO $$
DECLARE
  v_outbox_id uuid := current_setting('nova.qa.outbox_id')::uuid;
  v_old_lease_token uuid := current_setting('nova.qa.old_lease_token')::uuid;
  v_new_lease_token uuid;
  v_attempts integer;
  v_status text;
  v_provider_message_id text;
  v_sent_at timestamptz;
BEGIN
  SELECT lease_token, attempts INTO v_new_lease_token, v_attempts
  FROM nova.claim_notification_outbox(1, 120)
  WHERE id = v_outbox_id;
  IF v_new_lease_token IS NULL OR v_new_lease_token = v_old_lease_token OR v_attempts <> 2 THEN
    RAISE EXCEPTION 'expired notification lease was not recovered with a new token';
  END IF;
  IF EXISTS (
    SELECT 1 FROM nova.notification_outbox WHERE id = v_outbox_id
  ) THEN
    RAISE EXCEPTION 'application role could read the private notification queue';
  END IF;
  IF nova.finish_notification_outbox(
    v_outbox_id, v_old_lease_token, 'sent', NULL, '<stale-worker@local>', 300
  ) THEN
    RAISE EXCEPTION 'stale lease token was allowed to finish delivery';
  END IF;
  IF NOT nova.finish_notification_outbox(
    v_outbox_id, v_new_lease_token, 'sent', NULL, '<current-worker@local>', 300
  ) THEN
    RAISE EXCEPTION 'current lease token could not finish delivery';
  END IF;
  IF nova.finish_notification_outbox(
    v_outbox_id, v_new_lease_token, 'sent', NULL, '<duplicate-worker@local>', 300
  ) THEN
    RAISE EXCEPTION 'completed delivery accepted a replayed lease token';
  END IF;
END;
$$;

-- The API role intentionally cannot SELECT the delivery queue. Inspect the
-- persisted result as the migration-test role, then verify the worker function
-- still cannot claim the completed row while invoked as the application role.
RESET ROLE;
DO $$
DECLARE
  v_outbox_id uuid := current_setting('nova.qa.outbox_id')::uuid;
  v_attempts integer;
  v_status text;
  v_provider_message_id text;
  v_sent_at timestamptz;
BEGIN
  SELECT outbox.status, outbox.attempts, outbox.provider_message_id, outbox.sent_at
  INTO v_status, v_attempts, v_provider_message_id, v_sent_at
  FROM nova.notification_outbox outbox WHERE outbox.id = v_outbox_id;
  IF v_status <> 'sent' OR v_attempts <> 2
    OR v_provider_message_id <> '<current-worker@local>' OR v_sent_at IS NULL THEN
    RAISE EXCEPTION 'notification delivery outcome did not retain current lease result';
  END IF;
END;
$$;

SET LOCAL ROLE nova_app;
DO $$
DECLARE
  v_outbox_id uuid := current_setting('nova.qa.outbox_id')::uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM nova.claim_notification_outbox(1, 120) WHERE id = v_outbox_id) THEN
    RAISE EXCEPTION 'sent notification was claimable a second time';
  END IF;
END;
$$;

ROLLBACK;
