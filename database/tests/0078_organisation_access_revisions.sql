-- Run after 0078_organisation_access_revisions.sql with the migration/test role.
-- The fixture is rolled back; nova_app can read only the active request organisation.
BEGIN;

INSERT INTO nova.organisations (id, name) VALUES
  ('77777777-7777-4777-8777-777777777801', 'Access revision organisation A'),
  ('77777777-7777-4777-8777-777777777802', 'Access revision organisation B');

INSERT INTO nova.people (id, organisation_id, email, display_name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81', '77777777-7777-4777-8777-777777777801', 'access-revision-a@example.test', 'Access Revision A'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82', '77777777-7777-4777-8777-777777777802', 'access-revision-b@example.test', 'Access Revision B');

INSERT INTO nova.person_status_periods (person_id, status, effective_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81', 'active', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82', 'active', now() - interval '1 day');

INSERT INTO nova.offices (id, organisation_id, name, timezone) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81', '77777777-7777-4777-8777-777777777801', 'First office', 'Asia/Kolkata'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb82', '77777777-7777-4777-8777-777777777801', 'Second office', 'Asia/Kolkata');

INSERT INTO nova.organisation_departments (id, organisation_id, name) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc81', '77777777-7777-4777-8777-777777777801', 'Operations');

DO $$
BEGIN
  IF has_function_privilege(
       'public', 'nova.bump_organisation_access_revision(uuid)'::regprocedure, 'EXECUTE'
     ) OR has_function_privilege(
       'nova_app', 'nova.bump_organisation_access_revision(uuid)'::regprocedure, 'EXECUTE'
     ) OR has_function_privilege(
       'public', 'nova.bump_organisation_access_revision_for_row()'::regprocedure, 'EXECUTE'
     ) OR has_function_privilege(
       'nova_app', 'nova.bump_organisation_access_revision_for_row()'::regprocedure, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACCESS_REVISION_HELPERS_MUST_NOT_BE_CALLABLE_BY_PUBLIC_OR_APP';
  END IF;
END;
$$;

DO $$
DECLARE
  before_revision bigint;
  after_revision bigint;
  test_role_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddd81';
BEGIN
  SELECT revision INTO before_revision
  FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF before_revision IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ACCESS_REVISION_ORGANISATION_BACKFILL_FAILED';
  END IF;

  INSERT INTO nova.roles (id, organisation_id, key, name)
  VALUES (test_role_id, '77777777-7777-4777-8777-777777777801', 'access_revision_test', 'Access Revision Test');
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_ROLE_INSERT_MISSED'; END IF;

  before_revision := after_revision;
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
  VALUES (test_role_id, 'attendance.view', 'organisation');
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_GRANT_INSERT_MISSED'; END IF;

  before_revision := after_revision;
  UPDATE nova.role_permission_grants
  SET scope = 'office', office_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81'
  WHERE role_id = test_role_id AND permission_key = 'attendance.view';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_GRANT_SCOPE_CHANGE_MISSED'; END IF;

  before_revision := after_revision;
  UPDATE nova.role_permission_grants
  SET office_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb82'
  WHERE role_id = test_role_id AND permission_key = 'attendance.view';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_GRANT_TARGET_CHANGE_MISSED'; END IF;

  before_revision := after_revision;
  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81', test_role_id, '2026-01-01');
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_ROLE_ASSIGNMENT_INSERT_MISSED'; END IF;

  before_revision := after_revision;
  UPDATE nova.roles SET archived_at = now() WHERE id = test_role_id;
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_ROLE_ARCHIVE_MISSED'; END IF;

  before_revision := after_revision;
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81', '2026-01-01');
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_OFFICE_ASSIGNMENT_INSERT_MISSED'; END IF;

  before_revision := after_revision;
  UPDATE nova.person_office_assignments SET effective_until = '2026-12-31'
  WHERE person_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_OFFICE_ASSIGNMENT_UPDATE_MISSED'; END IF;

  before_revision := after_revision;
  DELETE FROM nova.person_office_assignments
  WHERE person_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_OFFICE_ASSIGNMENT_DELETE_MISSED'; END IF;

  before_revision := after_revision;
  INSERT INTO nova.person_department_assignments (person_id, organisation_department_id, effective_on)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81', 'cccccccc-cccc-4ccc-8ccc-cccccccccc81', '2026-01-01');
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_DEPARTMENT_ASSIGNMENT_INSERT_MISSED'; END IF;

  before_revision := after_revision;
  UPDATE nova.person_department_assignments SET effective_until = '2026-12-31'
  WHERE person_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_DEPARTMENT_ASSIGNMENT_UPDATE_MISSED'; END IF;

  before_revision := after_revision;
  DELETE FROM nova.person_department_assignments
  WHERE person_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  IF after_revision <= before_revision THEN RAISE EXCEPTION 'ACCESS_REVISION_DEPARTMENT_ASSIGNMENT_DELETE_MISSED'; END IF;

  SELECT revision INTO before_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777802';
  UPDATE nova.people SET organisation_id = '77777777-7777-4777-8777-777777777802'
  WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81';
  IF (SELECT revision FROM nova.organisation_access_revisions
      WHERE organisation_id = '77777777-7777-4777-8777-777777777801') <= before_revision
     OR (SELECT revision FROM nova.organisation_access_revisions
         WHERE organisation_id = '77777777-7777-4777-8777-777777777802') <= after_revision THEN
    RAISE EXCEPTION 'ACCESS_REVISION_PERSON_ORGANISATION_MOVE_MISSED';
  END IF;
  UPDATE nova.people SET organisation_id = '77777777-7777-4777-8777-777777777801'
  WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81';

  SELECT revision INTO before_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777802';
  UPDATE nova.offices SET organisation_id = '77777777-7777-4777-8777-777777777802'
  WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81';
  IF (SELECT revision FROM nova.organisation_access_revisions
      WHERE organisation_id = '77777777-7777-4777-8777-777777777801') <= before_revision
     OR (SELECT revision FROM nova.organisation_access_revisions
         WHERE organisation_id = '77777777-7777-4777-8777-777777777802') <= after_revision THEN
    RAISE EXCEPTION 'ACCESS_REVISION_OFFICE_ORGANISATION_MOVE_MISSED';
  END IF;
  UPDATE nova.offices SET organisation_id = '77777777-7777-4777-8777-777777777801'
  WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81';

  SELECT revision INTO before_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777801';
  SELECT revision INTO after_revision FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777802';
  UPDATE nova.organisation_departments SET organisation_id = '77777777-7777-4777-8777-777777777802'
  WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc81';
  IF (SELECT revision FROM nova.organisation_access_revisions
      WHERE organisation_id = '77777777-7777-4777-8777-777777777801') <= before_revision
     OR (SELECT revision FROM nova.organisation_access_revisions
         WHERE organisation_id = '77777777-7777-4777-8777-777777777802') <= after_revision THEN
    RAISE EXCEPTION 'ACCESS_REVISION_DEPARTMENT_ORGANISATION_MOVE_MISSED';
  END IF;
  UPDATE nova.organisation_departments SET organisation_id = '77777777-7777-4777-8777-777777777801'
  WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc81';
END;
$$;

GRANT nova_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA nova TO nova_app;
GRANT SELECT ON nova.organisation_access_revisions TO nova_app;
GRANT EXECUTE ON FUNCTION nova.request_has_valid_actor() TO nova_app;

SET LOCAL ROLE nova_app;
SELECT set_config('nova.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81', true);
SELECT set_config('nova.organisation_id', '77777777-7777-4777-8777-777777777801', true);

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM nova.organisation_access_revisions;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'ACCESS_REVISION_RLS_OWN_ORGANISATION_FAILED'; END IF;
  SELECT count(*) INTO visible_count FROM nova.organisation_access_revisions
  WHERE organisation_id = '77777777-7777-4777-8777-777777777802';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'ACCESS_REVISION_RLS_CROSS_ORGANISATION_READ_ALLOWED'; END IF;
END;
$$;

ROLLBACK;
