-- Proves the app can read only the boolean email opt-in for another recipient.
-- The preference row itself remains hidden by recipient RLS.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA notification preference test',
  'notification-preference-admin@example.test',
  'Notification Preference Admin',
  'better-auth-subject-notification-preference-admin'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_other_id uuid;
  v_enabled boolean;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-notification-preference-admin');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (v_organisation_id, 'notification-preference-other@example.test', 'Other Person')
  RETURNING id INTO v_other_id;
  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (v_other_id, 'active', now() - interval '1 day');

  PERFORM set_config('nova.user_id', v_other_id::text, true);
  INSERT INTO nova.notification_preferences (organisation_id, person_id, event_key, channel, enabled)
  VALUES (v_organisation_id, v_other_id, 'leave.approved', 'email', true);

  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  SELECT nova.notification_email_enabled(v_other_id, 'leave.approved') INTO v_enabled;
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'provider-neutral preference lookup did not return the opt-in';
  END IF;
END;
$$;

ROLLBACK;
