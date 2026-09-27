-- Proves the notification queue worker has a lease-token boundary.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA notification worker test',
  'notification-worker-admin@example.test',
  'Notification Worker Admin',
  'better-auth-subject-notification-worker'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_recipient_id uuid;
  v_notification_id uuid;
  v_outbox_id uuid;
  v_lease uuid;
  v_claimed integer;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-notification-worker');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  v_recipient_id := v_actor_id;

  INSERT INTO nova.notifications (
    organisation_id, recipient_person_id, event_key, title, body, idempotency_key
  ) VALUES (
    v_organisation_id, v_recipient_id, 'worker.test', 'Worker test', 'Worker test body', 'worker-test'
  ) RETURNING id INTO v_notification_id;

  SELECT nova.stage_notification_outbox(
    v_organisation_id, v_notification_id, v_recipient_id, 'worker.test',
    '{"title":"Worker test","body":"Worker test body"}'::jsonb
  ) INTO v_outbox_id;

  SELECT count(*)::integer, (array_agg(lease_token))[1] INTO v_claimed, v_lease
  FROM nova.claim_notification_outbox(10, 120)
  WHERE id = v_outbox_id;
  IF v_claimed <> 1 OR v_lease IS NULL THEN RAISE EXCEPTION 'notification outbox was not claimed'; END IF;

  IF NOT nova.finish_notification_outbox(v_outbox_id, v_lease, 'sent', NULL, 'test-message-id', 300) THEN
    RAISE EXCEPTION 'notification outbox was not completed';
  END IF;
END;
$$;

ROLLBACK;
