-- Portable, idempotent due-date reminders. This is deliberately a small
-- maintenance function, not a general event bus or a page-load side effect.

CREATE FUNCTION nova.enqueue_due_task_notifications(
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
  notification_id uuid;
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
    v_idempotency_key := format('%s:%s:%s', v_event_key, candidate.assignment_id, candidate.due_date);

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
    RETURNING id INTO notification_id;

    IF notification_id IS NOT NULL THEN
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
        SELECT tasks.organisation_id, notification_id, candidate.person_id,
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
    notification_id := NULL;
  END LOOP;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.enqueue_due_task_notifications(integer, integer) FROM PUBLIC;
