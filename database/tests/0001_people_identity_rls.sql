-- Run with a privileged migration/test role after 0001_people_identity.sql.
-- The temporary role proves that RLS works in PostgreSQL without Supabase.
BEGIN;

INSERT INTO nova.organisations (id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Organisation A'),
  ('22222222-2222-4222-8222-222222222222', 'Organisation B');

INSERT INTO nova.people (id, organisation_id, email, display_name) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'a@example.test',
    'Person A'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'b@example.test',
    'Person B'
  );

-- 0049 gates normal requests on a current operational status. Keep the
-- fixture active so this test exercises row isolation rather than the
-- lifecycle gate itself.
INSERT INTO nova.person_status_periods (person_id, status, effective_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active', now() - interval '1 day');

DO $$
BEGIN
  BEGIN
    INSERT INTO nova.people (id, organisation_id, email)
    VALUES (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '11111111-1111-4111-8111-111111111111',
      'Uppercase@example.test'
    );
    RAISE EXCEPTION 'PEOPLE_EMAIL_MUST_BE_LOWERCASE';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

CREATE ROLE nova_rls_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA nova TO nova_rls_test;
GRANT SELECT, INSERT ON nova.people TO nova_rls_test;
-- 0053 intentionally removes PUBLIC execute from the actor-validation helper;
-- grant it explicitly to the least-privileged role exercising the RLS policy.
GRANT EXECUTE ON FUNCTION nova.request_has_valid_actor() TO nova_rls_test;
GRANT nova_rls_test TO CURRENT_USER;

SET LOCAL ROLE nova_rls_test;
SELECT set_config('nova.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
SELECT set_config('nova.organisation_id', '11111111-1111-4111-8111-111111111111', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM nova.people) <> 1 THEN
    RAISE EXCEPTION 'RLS did not isolate organisation rows';
  END IF;

  BEGIN
    INSERT INTO nova.people (id, organisation_id, email, display_name)
    VALUES (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '22222222-2222-4222-8222-222222222222',
      'blocked@example.test',
      'Blocked cross-organisation insert'
    );
    RAISE EXCEPTION 'RLS allowed a cross-organisation insert';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
