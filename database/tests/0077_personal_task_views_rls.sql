-- Run after 0077_personal_task_views.sql with the migration/test role.
-- The fixture is rolled back; nova_app exercises the actual owner RLS policy.
BEGIN;

INSERT INTO nova.organisations (id, name) VALUES
  ('77777777-7777-4777-8777-777777777701', 'Task view organisation A'),
  ('77777777-7777-4777-8777-777777777702', 'Task view organisation B');

INSERT INTO nova.people (id, organisation_id, email, display_name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', '77777777-7777-4777-8777-777777777701', 'task-view-a@example.test', 'Task View A'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', '77777777-7777-4777-8777-777777777701', 'task-view-b@example.test', 'Task View B'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03', '77777777-7777-4777-8777-777777777702', 'task-view-c@example.test', 'Task View C');

INSERT INTO nova.person_status_periods (person_id, status, effective_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'active', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', 'active', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03', 'active', now() - interval '1 day');

GRANT nova_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA nova TO nova_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nova.personal_task_views TO nova_app;
GRANT EXECUTE ON FUNCTION nova.request_has_valid_actor() TO nova_app;

SET LOCAL ROLE nova_app;
SELECT set_config('nova.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', true);
SELECT set_config('nova.organisation_id', '77777777-7777-4777-8777-777777777701', true);

INSERT INTO nova.personal_task_views (
  organisation_id, person_id, sort_order, name, collection, status, due_filter, search_text
) VALUES
  ('77777777-7777-4777-8777-777777777701', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 1, 'Second', 'mine', 'assigned', 'any', 'second'),
  ('77777777-7777-4777-8777-777777777701', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 0, 'First', 'mine', 'assigned', 'any', 'first');

DO $$
DECLARE
  visible_count integer;
  ordered_names text[];
  denied boolean;
BEGIN
  SELECT count(*) INTO visible_count FROM nova.personal_task_views;
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'TASK_VIEW_OWNER_READ_SCOPE_FAILED';
  END IF;

  SELECT array_agg(name ORDER BY sort_order, id) INTO ordered_names
  FROM nova.personal_task_views;
  IF ordered_names IS DISTINCT FROM ARRAY['First', 'Second']::text[] THEN
    RAISE EXCEPTION 'TASK_VIEW_ORDERING_FAILED';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO nova.personal_task_views (
      organisation_id, person_id, sort_order, name, collection, status, due_filter
    ) VALUES (
      '77777777-7777-4777-8777-777777777701', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', 0, 'Other person', 'mine', 'assigned', 'any'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'TASK_VIEW_CROSS_PERSON_WRITE_ALLOWED';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO nova.personal_task_views (
      organisation_id, person_id, sort_order, name, collection, status, due_filter
    ) VALUES (
      '77777777-7777-4777-8777-777777777702', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03', 0, 'Other organisation', 'mine', 'assigned', 'any'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'TASK_VIEW_CROSS_ORGANISATION_WRITE_ALLOWED';
  END IF;
END;
$$;

ROLLBACK;
