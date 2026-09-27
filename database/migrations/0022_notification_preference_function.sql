-- Provider-neutral, boolean-only lookup used while staging an email for a
-- different recipient. Preference rows remain recipient-owned under RLS.

CREATE FUNCTION nova.notification_email_enabled(
  p_person_id uuid,
  p_event_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.notification_preferences preferences
    WHERE preferences.organisation_id = nova.request_organisation_id()
      AND preferences.person_id = p_person_id
      AND preferences.event_key = p_event_key
      AND preferences.channel = 'email'
      AND preferences.enabled = true
  );
$$;
