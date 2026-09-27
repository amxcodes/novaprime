-- NOVA notifications: durable in-app inbox with optional email staging.
-- Email delivery is deliberately opt-in; the inbox is the source of truth.

CREATE TABLE nova.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  recipient_person_id uuid NOT NULL REFERENCES nova.people(id),
  event_key text NOT NULL CHECK (btrim(event_key) <> '' AND length(event_key) <= 120),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 240),
  body text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 4000),
  aggregate_type text CHECK (aggregate_type IS NULL OR (btrim(aggregate_type) <> '' AND length(aggregate_type) <= 80)),
  aggregate_id uuid,
  deep_link text CHECK (deep_link IS NULL OR length(deep_link) <= 500),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 240),
  read_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_person_id, idempotency_key)
);

CREATE INDEX notifications_recipient_created
  ON nova.notifications (recipient_person_id, created_at DESC);
CREATE INDEX notifications_recipient_unread
  ON nova.notifications (recipient_person_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE nova.notification_preferences (
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  event_key text NOT NULL CHECK (btrim(event_key) <> '' AND length(event_key) <= 120),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, event_key, channel)
);

CREATE INDEX notification_preferences_organisation_person
  ON nova.notification_preferences (organisation_id, person_id);

CREATE TABLE nova.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  notification_id uuid NOT NULL REFERENCES nova.notifications(id) ON DELETE CASCADE,
  recipient_person_id uuid NOT NULL REFERENCES nova.people(id),
  event_key text NOT NULL CHECK (btrim(event_key) <> '' AND length(event_key) <= 120),
  channel text NOT NULL CHECK (channel = 'email'),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (notification_id, channel)
);

CREATE INDEX notification_outbox_claimable
  ON nova.notification_outbox (status, available_at, lease_until);

CREATE FUNCTION nova.notification_preferences_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preferences_touch_updated_at
BEFORE UPDATE ON nova.notification_preferences
FOR EACH ROW EXECUTE FUNCTION nova.notification_preferences_touch_updated_at();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('notifications.manage', 'notifications', 'Manage organisation notification defaults and delivery administration.'),
  ('notifications.delivery.view', 'notifications', 'View notification delivery status and failures.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('notifications.manage', 'notifications.delivery.view')
ON CONFLICT DO NOTHING;

ALTER TABLE nova.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Inbox rows are readable and mutable only by their recipient. The API's
-- command layer controls which organisation-scoped rows may be inserted.
CREATE POLICY notifications_recipient_read ON nova.notifications
FOR SELECT USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND recipient_person_id = nova.request_user_id()
);

CREATE POLICY notifications_recipient_update ON nova.notifications
FOR UPDATE USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND recipient_person_id = nova.request_user_id()
) WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND recipient_person_id = nova.request_user_id()
);

CREATE POLICY notifications_api_insert ON nova.notifications
FOR INSERT WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND EXISTS (
    SELECT 1 FROM nova.people recipient
    WHERE recipient.id = recipient_person_id
      AND recipient.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY notification_preferences_owner ON nova.notification_preferences
FOR ALL USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND person_id = nova.request_user_id()
) WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND person_id = nova.request_user_id()
);

-- The normal API may stage an explicitly opted-in email, but cannot read or
-- mutate the queue. A narrow worker role can be granted queue access later.
CREATE POLICY notification_outbox_api_insert ON nova.notification_outbox
FOR INSERT WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND EXISTS (
    SELECT 1 FROM nova.people recipient
    WHERE recipient.id = recipient_person_id
      AND recipient.organisation_id = nova.request_organisation_id()
  )
);
