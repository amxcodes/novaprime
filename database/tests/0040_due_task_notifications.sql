-- Proves due reminders are idempotent and do not require an email provider.
-- Always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA due notification test', 'due-notification@example.test', 'Due Notification', 'due-notification-subject');
DO $$
DECLARE
  a uuid; o uuid; w uuid; overdue_task uuid; soon_task uuid; overdue_assignment uuid; soon_assignment uuid; created integer; repeated integer;
BEGIN
  SELECT user_id, organisation_id INTO a, o
  FROM nova.resolve_authenticated_actor('due-notification-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (o, 'Due Workstream', a) RETURNING id INTO w;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, due_date, created_by_person_id)
  VALUES (o, w, 'Overdue task', current_date - 1, a) RETURNING id INTO overdue_task;
  INSERT INTO nova.tasks (organisation_id, organisation_workstream_id, title, due_date, created_by_person_id)
  VALUES (o, w, 'Soon task', current_date + 1, a) RETURNING id INTO soon_task;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, assigned_by_person_id)
  VALUES (o, overdue_task, a, false, a) RETURNING id INTO overdue_assignment;
  INSERT INTO nova.task_assignments (organisation_id, task_id, person_id, review_required, assigned_by_person_id)
  VALUES (o, soon_task, a, false, a) RETURNING id INTO soon_assignment;
  SELECT nova.enqueue_due_task_notifications(1, 20) INTO created;
  IF created <> 2 THEN RAISE EXCEPTION 'expected two due notifications, got %', created; END IF;
  SELECT nova.enqueue_due_task_notifications(1, 20) INTO repeated;
  IF repeated <> 0 THEN RAISE EXCEPTION 'due notifications were not idempotent'; END IF;
  IF (SELECT count(*) FROM nova.notifications WHERE recipient_person_id = a) <> 2 THEN
    RAISE EXCEPTION 'unexpected notification count';
  END IF;
END;
$$;
ROLLBACK;
