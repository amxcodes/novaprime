-- Proves delivery inspection/replay is organisation-bound and narrow.
-- Always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA notification operations test', 'notification-ops@example.test', 'Notification Ops', 'notification-ops-subject');
DO $$
DECLARE
  a uuid; o uuid; n uuid; outbox_id uuid; lease uuid; visible integer;
BEGIN
  SELECT user_id, organisation_id INTO a, o
  FROM nova.resolve_authenticated_actor('notification-ops-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  INSERT INTO nova.notifications (
    organisation_id, recipient_person_id, event_key, title, body, idempotency_key
  ) VALUES (o, a, 'task.assigned', 'Task assigned', 'Delivery test', 'notification-ops-test')
  RETURNING id INTO n;
  SELECT nova.stage_notification_outbox(o, n, a, 'task.assigned', '{"title":"Task assigned","body":"Delivery test"}'::jsonb)
  INTO outbox_id;
  SELECT id, lease_token INTO outbox_id, lease
  FROM nova.claim_notification_outbox(1, 120)
  LIMIT 1;
  PERFORM nova.finish_notification_outbox(outbox_id, lease, 'dead_letter', 'TEST_FAILURE', NULL, 300);
  SELECT count(*) INTO visible FROM nova.read_notification_delivery(10);
  IF visible <> 1 THEN RAISE EXCEPTION 'delivery inspection did not return the organisation row'; END IF;
  IF NOT nova.requeue_notification_delivery(outbox_id) THEN RAISE EXCEPTION 'delivery replay did not requeue'; END IF;
END;
$$;
ROLLBACK;
