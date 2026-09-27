-- Notification fan-out is a domain command boundary, not a recipient read.
-- Keep the table RLS recipient-scoped while exposing one narrow, idempotent
-- enqueue function for authorised API transactions.
CREATE OR REPLACE FUNCTION nova.enqueue_notification(
  p_organisation_id uuid,
  p_recipient_person_id uuid,
  p_event_key text,
  p_title text,
  p_body text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_deep_link text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  notification_id uuid;
BEGIN
  IF NOT nova.request_has_valid_actor()
    OR p_organisation_id IS DISTINCT FROM nova.request_organisation_id()
    OR NOT EXISTS (
      SELECT 1
      FROM nova.people recipient
      WHERE recipient.id = p_recipient_person_id
        AND recipient.organisation_id = p_organisation_id
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'NOTIFICATION_ENQUEUE_NOT_ALLOWED';
  END IF;

  INSERT INTO nova.notifications (
    organisation_id,
    recipient_person_id,
    event_key,
    title,
    body,
    aggregate_type,
    aggregate_id,
    deep_link,
    idempotency_key
  ) VALUES (
    p_organisation_id,
    p_recipient_person_id,
    p_event_key,
    p_title,
    p_body,
    p_aggregate_type,
    p_aggregate_id,
    p_deep_link,
    p_idempotency_key
  )
  ON CONFLICT (recipient_person_id, idempotency_key) DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT id INTO notification_id
    FROM nova.notifications
    WHERE recipient_person_id = p_recipient_person_id
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN notification_id;
END;
$$;

REVOKE ALL ON FUNCTION nova.enqueue_notification(uuid, uuid, text, text, text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nova.enqueue_notification(uuid, uuid, text, text, text, text, uuid, text, text) TO nova_app;
