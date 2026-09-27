BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA timeline view scope test', 'timeline-view-scope@example.test', 'Timeline View Scope', 'timeline-view-scope-subject');
DO $$
DECLARE a uuid; o uuid;
BEGIN
  SELECT user_id, organisation_id INTO a, o
  FROM nova.resolve_authenticated_actor('timeline-view-scope-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  IF NOT EXISTS (
    SELECT 1 FROM nova.permissions
    WHERE key = 'work.timeline.view'
      AND 'own_record'::nova.permission_scope = ANY(allowed_scopes)
  ) THEN
    RAISE EXCEPTION 'own timeline view scope is missing';
  END IF;
END;
$$;
ROLLBACK;
