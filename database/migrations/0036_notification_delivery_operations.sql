-- Narrow operator read/replay boundary for optional notification delivery.
-- Domain requests never receive queue access; the API must still enforce the
-- notifications.delivery.view/manage permissions before calling these.

CREATE FUNCTION nova.read_notification_delivery(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  organisation_id uuid,
  recipient_person_id uuid,
  event_key text,
  status text,
  attempts integer,
  available_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz,
  sent_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT outbox.id, outbox.organisation_id, outbox.recipient_person_id,
         outbox.event_key, outbox.status, outbox.attempts,
         outbox.available_at, outbox.last_error, outbox.provider_message_id,
         outbox.created_at, outbox.sent_at
  FROM nova.notification_outbox outbox
  WHERE outbox.organisation_id = nova.request_organisation_id()
  ORDER BY outbox.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$$;

CREATE FUNCTION nova.requeue_notification_delivery(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  WITH updated AS (
    UPDATE nova.notification_outbox
    SET status = 'pending', attempts = 0, available_at = clock_timestamp(),
        lease_until = NULL, lease_token = NULL, last_error = NULL,
        provider_message_id = NULL, sent_at = NULL
    WHERE id = p_id
      AND organisation_id = nova.request_organisation_id()
      AND status IN ('failed', 'dead_letter')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

REVOKE ALL ON FUNCTION nova.read_notification_delivery(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.requeue_notification_delivery(uuid) FROM PUBLIC;
