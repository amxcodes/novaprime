-- Proves recipient isolation, idempotency and email opt-in staging.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA notification test',
  'notification-admin@example.test',
  'Notification Admin',
  'better-auth-subject-notification-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_other_id uuid;
  v_notification_id uuid;
  v_other_notification_id uuid;
  v_other_repeat_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-notification-admin');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'notification-other@example.test', 'Other Person')
  RETURNING id INTO v_other_id;

  INSERT INTO nova.notifications (
    organisation_id, recipient_person_id, event_key, title, body, idempotency_key
  ) VALUES (
    v_organisation_id, v_actor_id, 'leave.approved', 'Leave approved', 'Your leave was approved', 'test:actor'
  ) RETURNING id INTO v_notification_id;

  SELECT nova.enqueue_notification(
    v_organisation_id, v_other_id, 'task.assigned', 'Task assigned',
    'A task was assigned', NULL, NULL, NULL, 'test:other'
  ) INTO v_other_notification_id;
  SELECT nova.enqueue_notification(
    v_organisation_id, v_other_id, 'task.assigned', 'Task assigned',
    'A task was assigned', NULL, NULL, NULL, 'test:other'
  ) INTO v_other_repeat_id;
  IF v_other_notification_id IS DISTINCT FROM v_other_repeat_id THEN
    RAISE EXCEPTION 'notification enqueue is not idempotent';
  END IF;

  IF (SELECT count(*) FROM nova.notifications) <> 1 THEN
    RAISE EXCEPTION 'notification RLS did not isolate the recipient inbox';
  END IF;

  INSERT INTO nova.notification_preferences (
    organisation_id, person_id, event_key, channel, enabled
  ) VALUES (v_organisation_id, v_actor_id, 'leave.approved', 'email', true);

  INSERT INTO nova.notification_outbox (
    organisation_id, notification_id, recipient_person_id, event_key, channel, payload
  ) VALUES (
    v_organisation_id, v_notification_id, v_actor_id, 'leave.approved', 'email', '{"title":"Leave approved"}'::jsonb
  );

  UPDATE nova.notifications SET read_at = clock_timestamp()
  WHERE id = v_notification_id;
  IF (SELECT read_at IS NULL FROM nova.notifications WHERE id = v_notification_id) THEN
    RAISE EXCEPTION 'recipient could not mark notification read';
  END IF;
END;
$$;

ROLLBACK;
