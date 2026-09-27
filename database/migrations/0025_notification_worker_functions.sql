-- Provider-neutral notification delivery worker boundary.
-- Normal API requests may enqueue rows but cannot read or mutate the queue.
-- These narrow, lease-token functions let an explicit maintenance worker
-- process the queue without giving the normal application role table bypass.

ALTER TABLE nova.notification_outbox
  ADD COLUMN lease_token uuid;

CREATE FUNCTION nova.stage_notification_outbox(
  p_organisation_id uuid,
  p_notification_id uuid,
  p_recipient_person_id uuid,
  p_event_key text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  staged_id uuid;
BEGIN
  IF NOT nova.request_has_valid_actor()
    OR p_organisation_id IS DISTINCT FROM nova.request_organisation_id()
    OR NOT EXISTS (
      SELECT 1 FROM nova.notifications
      WHERE id = p_notification_id
        AND organisation_id = p_organisation_id
        AND recipient_person_id = p_recipient_person_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'NOTIFICATION_OUTBOX_NOT_ALLOWED';
  END IF;

  INSERT INTO nova.notification_outbox (
    organisation_id, notification_id, recipient_person_id, event_key, channel, payload
  ) VALUES (p_organisation_id, p_notification_id, p_recipient_person_id, p_event_key, 'email', p_payload)
  ON CONFLICT (notification_id, channel) DO NOTHING
  RETURNING id INTO staged_id;

  IF staged_id IS NULL THEN
    SELECT id INTO staged_id FROM nova.notification_outbox
    WHERE notification_id = p_notification_id AND channel = 'email';
  END IF;
  RETURN staged_id;
END;
$$;

CREATE FUNCTION nova.claim_notification_outbox(
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

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM nova.notification_outbox outbox
    WHERE outbox.attempts < 5
      AND outbox.available_at <= clock_timestamp()
      AND (
        outbox.status IN ('pending', 'failed')
        OR (outbox.status = 'processing' AND outbox.lease_until < clock_timestamp())
      )
    ORDER BY outbox.available_at, outbox.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
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

CREATE FUNCTION nova.finish_notification_outbox(
  p_id uuid,
  p_lease_token uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_retry_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'dead_letter')
    OR (p_status = 'failed' AND (p_retry_seconds < 30 OR p_retry_seconds > 86400)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'NOTIFICATION_WORKER_STATUS_INVALID';
  END IF;

  UPDATE nova.notification_outbox
  SET status = p_status,
      lease_until = NULL,
      lease_token = NULL,
      last_error = CASE WHEN p_status = 'sent' THEN NULL ELSE left(COALESCE(p_error, 'DELIVERY_FAILED'), 1000) END,
      provider_message_id = CASE WHEN p_status = 'sent' THEN p_provider_message_id ELSE provider_message_id END,
      sent_at = CASE WHEN p_status = 'sent' THEN clock_timestamp() ELSE sent_at END,
      available_at = CASE WHEN p_status = 'failed'
        THEN clock_timestamp() + make_interval(secs => p_retry_seconds)
        ELSE available_at END
  WHERE id = p_id
    AND lease_token = p_lease_token
    AND status = 'processing';

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$$;

REVOKE ALL ON FUNCTION nova.claim_notification_outbox(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.finish_notification_outbox(uuid, uuid, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.stage_notification_outbox(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
