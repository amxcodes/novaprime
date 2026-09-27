-- The boolean preference lookup is an application-internal primitive, not a
-- public SQL API. The deployment bootstrap grants it to the app role.
REVOKE ALL ON FUNCTION nova.notification_email_enabled(uuid, text) FROM PUBLIC;
