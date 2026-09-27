-- Run with a privileged migration/test role after 0002_authentication_bootstrap.sql.
-- The transaction proves that the non-owner application role can perform only
-- the one-time bootstrap function, while the test leaves no fixture data.
BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'Bootstrap Organisation',
  'admin@example.test',
  'Initial Admin',
  'better-auth-subject-1'
);

DO $$
BEGIN
  BEGIN
    PERFORM nova.bootstrap_organisation(
      'Second Organisation',
      'second@example.test',
      'Second Admin',
      'better-auth-subject-2'
    );
    RAISE EXCEPTION 'BOOTSTRAP_ALLOWED_MORE_THAN_ONCE';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM nova.organisations) <> 1 THEN
    RAISE EXCEPTION 'BOOTSTRAP_DID_NOT_CREATE_ORGANISATION';
  END IF;

  IF (SELECT count(*) FROM nova.people) <> 1
    OR (SELECT count(*) FROM nova.person_identities) <> 1
    OR (SELECT count(*) FROM nova.person_status_periods WHERE status = 'active') <> 1
    OR (SELECT count(*) FROM nova.person_role_assignments) <> 1
    OR (SELECT count(*) FROM nova.audit_events WHERE action = 'organisation.bootstrap') <> 1 THEN
    RAISE EXCEPTION 'BOOTSTRAP_DID_NOT_CREATE_COMPLETE_SUPER_ADMIN_CONTEXT';
  END IF;

  IF (SELECT count(*) FROM nova.role_permission_grants) <> (SELECT count(*) FROM nova.permissions) THEN
    RAISE EXCEPTION 'BOOTSTRAP_DID_NOT_GRANT_ALL_CURRENT_PERMISSIONS';
  END IF;
END;
$$;

ROLLBACK;
