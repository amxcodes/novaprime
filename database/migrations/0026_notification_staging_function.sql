-- Compatibility repair: the first worker migration was applied before the
-- narrow API staging function was added. Keep this idempotent for both fresh
-- installs and already-bootstrapped deployments.

CREATE OR REPLACE FUNCTION nova.stage_notification_outbox(
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

REVOKE ALL ON FUNCTION nova.stage_notification_outbox(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
