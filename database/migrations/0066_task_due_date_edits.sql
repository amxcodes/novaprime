-- Optimistic task due-date edits invalidate stale reminders and notify current
-- assignees. PostgreSQL DATE is retained: a due date is a local calendar day,
-- not a timestamp.

ALTER TABLE nova.tasks
  ADD COLUMN due_date_revision integer NOT NULL DEFAULT 0
    CHECK (due_date_revision >= 0);

CREATE FUNCTION nova.advance_task_due_date_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.due_date_revision := OLD.due_date_revision + 1;
  ELSIF NEW.due_date_revision IS DISTINCT FROM OLD.due_date_revision THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_DUE_DATE_REVISION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_advance_due_date_revision
BEFORE UPDATE ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.advance_task_due_date_revision();

ALTER TABLE nova.notification_outbox
  DROP CONSTRAINT notification_outbox_status_check,
  ADD CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter', 'cancelled'));

CREATE FUNCTION nova.expire_task_due_notifications(p_task_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  affected integer;
  request_organisation uuid;
BEGIN
  IF NOT nova.request_has_valid_actor() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TASK_DUE_NOTIFICATION_INVALID_ACTOR';
  END IF;
  request_organisation := nova.request_organisation_id();
  IF NOT EXISTS (
    SELECT 1 FROM nova.tasks
    WHERE id = p_task_id AND organisation_id = request_organisation
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TASK_DUE_NOTIFICATION_SCOPE_INVALID';
  END IF;

  UPDATE nova.notifications notifications
  SET expires_at = clock_timestamp()
  FROM nova.task_assignments assignments
  WHERE assignments.task_id = p_task_id
    AND assignments.organisation_id = request_organisation
    AND notifications.organisation_id = request_organisation
    AND notifications.aggregate_type = 'task_assignment'
    AND notifications.aggregate_id = assignments.id
    AND notifications.event_key IN ('task.due_soon', 'task.overdue')
    AND (notifications.expires_at IS NULL OR notifications.expires_at > clock_timestamp());
  GET DIAGNOSTICS affected = ROW_COUNT;

  UPDATE nova.notification_outbox outbox
  SET status = 'cancelled', lease_until = NULL, lease_token = NULL,
      last_error = 'TASK_DUE_DATE_CHANGED'
  FROM nova.notifications notifications, nova.task_assignments assignments
  WHERE assignments.task_id = p_task_id
    AND assignments.organisation_id = request_organisation
    AND notifications.organisation_id = request_organisation
    AND notifications.aggregate_type = 'task_assignment'
    AND notifications.aggregate_id = assignments.id
    AND notifications.event_key IN ('task.due_soon', 'task.overdue')
    AND notifications.expires_at <= clock_timestamp()
    AND outbox.notification_id = notifications.id
    AND outbox.status IN ('pending', 'failed', 'processing');

  RETURN affected;
END;
$$;

CREATE FUNCTION nova.notification_outbox_lease_is_current(p_id uuid, p_lease_token uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.notification_outbox outbox
    JOIN nova.notifications notifications ON notifications.id = outbox.notification_id
    WHERE outbox.id = p_id
      AND outbox.lease_token = p_lease_token
      AND outbox.status = 'processing'
      AND outbox.lease_until > clock_timestamp()
      AND (notifications.expires_at IS NULL OR notifications.expires_at > clock_timestamp())
  );
$$;

CREATE OR REPLACE FUNCTION nova.claim_notification_outbox(
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  id uuid,
  notification_id uuid,
  organisation_id uuid,
  recipient_person_id uuid,
  recipient_email text,
  event_key text,
  payload jsonb,
  attempts integer,
  lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 15 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'NOTIFICATION_WORKER_INPUT_INVALID';
  END IF;

  UPDATE nova.notification_outbox outbox
  SET status = 'cancelled', lease_until = NULL, lease_token = NULL,
      last_error = 'NOTIFICATION_EXPIRED'
  WHERE outbox.status IN ('pending', 'failed', 'processing')
    AND EXISTS (
      SELECT 1 FROM nova.notifications notifications
      WHERE notifications.id = outbox.notification_id
        AND notifications.expires_at <= clock_timestamp()
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM nova.notification_outbox outbox
    JOIN nova.notifications notifications ON notifications.id = outbox.notification_id
    WHERE outbox.attempts < 5
      AND outbox.available_at <= clock_timestamp()
      AND (notifications.expires_at IS NULL OR notifications.expires_at > clock_timestamp())
      AND (
        outbox.status IN ('pending', 'failed')
        OR (outbox.status = 'processing' AND outbox.lease_until < clock_timestamp())
      )
    ORDER BY outbox.available_at, outbox.created_at
    LIMIT p_limit
    FOR UPDATE OF outbox SKIP LOCKED
  ), claimed AS (
    UPDATE nova.notification_outbox outbox
    SET status = 'processing',
        attempts = outbox.attempts + 1,
        lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        lease_token = gen_random_uuid(),
        last_error = NULL
    FROM candidates
    WHERE outbox.id = candidates.id
    RETURNING outbox.*
  )
  SELECT claimed.id,
         claimed.notification_id,
         claimed.organisation_id,
         claimed.recipient_person_id,
         people.email,
         claimed.event_key,
         claimed.payload,
         claimed.attempts,
         claimed.lease_token
  FROM claimed
  JOIN nova.people people ON people.id = claimed.recipient_person_id;
END;
$$;

CREATE OR REPLACE FUNCTION nova.enqueue_due_task_notifications(
  p_horizon_days integer DEFAULT 1,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  candidate record;
  v_notification_id uuid;
  v_event_key text;
  v_event_title text;
  v_event_body text;
  v_idempotency_key text;
  inserted_count integer := 0;
BEGIN
  IF p_horizon_days < 0 OR p_horizon_days > 7
    OR p_limit < 1 OR p_limit > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DUE_NOTIFICATION_INPUT_INVALID';
  END IF;

  FOR candidate IN
    SELECT assignments.id AS assignment_id,
           assignments.person_id,
           tasks.id AS task_id,
           tasks.title,
           tasks.due_date,
           tasks.due_date_revision,
           nova.person_business_date(assignments.person_id) AS business_date
    FROM nova.task_assignments assignments
    JOIN nova.tasks tasks ON tasks.id = assignments.task_id
    JOIN nova.person_status_periods status
      ON status.person_id = assignments.person_id AND status.ended_at IS NULL
    WHERE assignments.status NOT IN ('approved', 'cancelled')
      AND tasks.status NOT IN ('approved', 'done', 'cancelled')
      AND status.status IN ('active', 'notice')
      AND tasks.due_date IS NOT NULL
      AND (
        tasks.due_date < nova.person_business_date(assignments.person_id)
        OR tasks.due_date <= nova.person_business_date(assignments.person_id) + p_horizon_days
      )
    ORDER BY tasks.due_date, assignments.assigned_at
    LIMIT p_limit
    FOR UPDATE OF tasks SKIP LOCKED
  LOOP
    IF candidate.due_date < candidate.business_date THEN
      v_event_key := 'task.overdue';
      v_event_title := 'Task overdue';
      v_event_body := format('This assigned task is overdue: %s.', candidate.title);
    ELSE
      v_event_key := 'task.due_soon';
      v_event_title := 'Task due soon';
      v_event_body := format('This assigned task is due on %s: %s.', candidate.due_date, candidate.title);
    END IF;
    v_idempotency_key := format('%s:%s:%s:%s', v_event_key, candidate.assignment_id,
      candidate.due_date_revision, candidate.due_date);

    INSERT INTO nova.notifications (
      organisation_id, recipient_person_id, event_key, title, body,
      aggregate_type, aggregate_id, deep_link, idempotency_key
    )
    SELECT tasks.organisation_id, candidate.person_id, v_event_key, v_event_title,
           v_event_body, 'task_assignment', candidate.assignment_id,
           '/?view=work&task=' || candidate.task_id, v_idempotency_key
    FROM nova.tasks tasks
    WHERE tasks.id = candidate.task_id
    ON CONFLICT (recipient_person_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    IF v_notification_id IS NOT NULL THEN
      inserted_count := inserted_count + 1;
      IF EXISTS (
        SELECT 1
        FROM nova.notification_preferences preferences
        JOIN nova.people people ON people.id = preferences.person_id
        WHERE preferences.organisation_id = people.organisation_id
          AND preferences.person_id = candidate.person_id
          AND preferences.event_key = v_event_key
          AND preferences.channel = 'email'
          AND preferences.enabled = true
      ) THEN
        INSERT INTO nova.notification_outbox (
          organisation_id, notification_id, recipient_person_id, event_key,
          channel, payload
        )
        SELECT tasks.organisation_id, v_notification_id, candidate.person_id,
               v_event_key, 'email', jsonb_build_object(
                 'title', v_event_title,
                 'body', v_event_body,
                 'deepLink', '/?view=work&task=' || candidate.task_id
               )
        FROM nova.tasks tasks
        WHERE tasks.id = candidate.task_id
        ON CONFLICT (notification_id, channel) DO NOTHING;
      END IF;
    END IF;
    v_notification_id := NULL;
  END LOOP;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.expire_task_due_notifications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.notification_outbox_lease_is_current(uuid, uuid) FROM PUBLIC;
