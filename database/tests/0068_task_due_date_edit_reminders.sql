-- Due-date edits are optimistic, audited domain changes. They invalidate old
-- in-app/email reminders and each real revision can be reminded once.
-- Test-only fixture; always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA task due-date edit test',
  'task-due-date-admin@example.test',
  'Task Due Date Admin',
  'better-auth-subject-task-due-date'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_workstream_id uuid;
  v_task_id uuid;
  v_assignment_id uuid;
  v_notification_id uuid;
  v_outbox_id uuid;
  v_lease_token uuid;
  v_business_date date;
  v_expired integer;
  v_queued integer;
  v_status text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-task-due-date');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  v_business_date := nova.person_business_date(v_actor_id);

  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Due date workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.tasks (
    organisation_id, organisation_workstream_id, title, due_date, created_by_person_id
  ) VALUES (v_organisation_id, v_workstream_id, 'Rescheduled task', v_business_date, v_actor_id)
  RETURNING id INTO v_task_id;
  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, assigned_by_person_id
  ) VALUES (v_organisation_id, v_task_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;
  INSERT INTO nova.notification_preferences (
    organisation_id, person_id, event_key, channel, enabled
  ) VALUES (v_organisation_id, v_actor_id, 'task.due_soon', 'email', true);

  IF (SELECT due_date_revision FROM nova.tasks WHERE id = v_task_id) <> 0 THEN
    RAISE EXCEPTION 'new task due-date revision did not start at zero';
  END IF;
  IF nova.enqueue_due_task_notifications(1, 20) <> 1 THEN
    RAISE EXCEPTION 'initial due reminder was not queued';
  END IF;
  SELECT notifications.id INTO v_notification_id
  FROM nova.notifications notifications
  WHERE notifications.aggregate_id = v_assignment_id
    AND notifications.event_key = 'task.due_soon'
    AND notifications.expires_at IS NULL;
  SELECT outbox.id, outbox.lease_token INTO v_outbox_id, v_lease_token
  FROM nova.claim_notification_outbox(20, 120) outbox
  WHERE outbox.notification_id = v_notification_id;
  IF v_outbox_id IS NULL OR v_lease_token IS NULL THEN
    RAISE EXCEPTION 'opted-in due email was not claimable';
  END IF;

  UPDATE nova.tasks SET due_date = v_business_date + 1 WHERE id = v_task_id;
  IF (SELECT due_date_revision FROM nova.tasks WHERE id = v_task_id) <> 1 THEN
    RAISE EXCEPTION 'due-date revision did not advance';
  END IF;
  v_expired := nova.expire_task_due_notifications(v_task_id);
  IF v_expired <> 1 THEN RAISE EXCEPTION 'old due reminder did not expire'; END IF;
  IF nova.notification_outbox_lease_is_current(v_outbox_id, v_lease_token) THEN
    RAISE EXCEPTION 'cancelled email lease was still current';
  END IF;
  SELECT delivery.status INTO v_status
  FROM nova.read_notification_delivery(200) delivery
  WHERE delivery.id = v_outbox_id;
  IF v_status <> 'cancelled' THEN RAISE EXCEPTION 'old leased email was not cancelled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nova.notifications
    WHERE id = v_notification_id AND expires_at <= clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'old inbox reminder remained current';
  END IF;

  IF nova.enqueue_due_task_notifications(1, 20) <> 1 THEN
    RAISE EXCEPTION 'new due-date revision did not receive its reminder';
  END IF;
  IF nova.enqueue_due_task_notifications(1, 20) <> 0 THEN
    RAISE EXCEPTION 'repeated tick duplicated a due reminder';
  END IF;

  UPDATE nova.tasks SET due_date = v_business_date WHERE id = v_task_id;
  IF (SELECT due_date_revision FROM nova.tasks WHERE id = v_task_id) <> 2 THEN
    RAISE EXCEPTION 'return to a prior date did not create a new revision';
  END IF;
  PERFORM nova.expire_task_due_notifications(v_task_id);
  IF nova.enqueue_due_task_notifications(1, 20) <> 1 THEN
    RAISE EXCEPTION 'return to prior date reused an expired idempotency key';
  END IF;

  BEGIN
    UPDATE nova.tasks SET due_date_revision = 99 WHERE id = v_task_id;
    RAISE EXCEPTION 'due-date revision could be changed directly';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'TASK_DUE_DATE_REVISION_IMMUTABLE' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
