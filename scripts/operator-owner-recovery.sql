-- NOVA break-glass owner recovery (operator-only; never expose as an API route)
--
-- Run only with the migration-owner connection after stopping NOVA API/workers,
-- taking a backup, and obtaining two-person approval for the incident. Create
-- the temporary Better Auth user through the configured auth adapter first;
-- this script never creates a password or writes a Better Auth account hash.
--
-- Example (PowerShell; values must be supplied out-of-band):
--   psql "$env:MIGRATOR_DATABASE_URL" `
--     -v nova_organisation_id="..." `
--     -v nova_auth_user_id="..." `
--     -v nova_email="recovery@example.test" `
--     -v nova_display_name="NOVA Recovery" `
--     -v nova_incident_id="INC-..." `
--     -v nova_reason="..." `
--     -v nova_approver_a="operator-a" `
--     -v nova_approver_b="operator-b" `
--     -f scripts/operator-owner-recovery.sql

\set ON_ERROR_STOP on

\if :{?nova_organisation_id}
\else
  \echo 'nova_organisation_id is required'
  \quit 3
\endif
\if :{?nova_auth_user_id}
\else
  \echo 'nova_auth_user_id is required'
  \quit 3
\endif
\if :{?nova_email}
\else
  \echo 'nova_email is required'
  \quit 3
\endif
\if :{?nova_display_name}
\else
  \echo 'nova_display_name is required'
  \quit 3
\endif
\if :{?nova_incident_id}
\else
  \echo 'nova_incident_id is required'
  \quit 3
\endif
\if :{?nova_reason}
\else
  \echo 'nova_reason is required'
  \quit 3
\endif
\if :{?nova_approver_a}
\else
  \echo 'nova_approver_a is required'
  \quit 3
\endif
\if :{?nova_approver_b}
\else
  \echo 'nova_approver_b is required'
  \quit 3
\endif

BEGIN;

-- Keep every operator input in a transaction-local row. This also makes the
-- values available inside PostgreSQL dollar-quoted validation blocks without
-- relying on psql substitution inside quoted text.
CREATE TEMP TABLE nova_owner_recovery_input (
  organisation_id uuid NOT NULL,
  auth_user_id text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  incident_id text NOT NULL,
  reason text NOT NULL,
  approver_a text NOT NULL,
  approver_b text NOT NULL,
  person_id uuid
) ON COMMIT DROP;

INSERT INTO nova_owner_recovery_input (
  organisation_id,
  auth_user_id,
  email,
  display_name,
  incident_id,
  reason,
  approver_a,
  approver_b
)
VALUES (
  :'nova_organisation_id'::uuid,
  :'nova_auth_user_id',
  lower(btrim(:'nova_email')),
  btrim(:'nova_display_name'),
  btrim(:'nova_incident_id'),
  btrim(:'nova_reason'),
  btrim(:'nova_approver_a'),
  btrim(:'nova_approver_b')
);

DO $validation$
DECLARE
  organisation_exists boolean;
  auth_user_exists boolean;
  auth_user_verified boolean;
  existing_email boolean;
  protected_role_exists boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM nova_owner_recovery_input
    WHERE lower(approver_a) = lower(approver_b)
      OR approver_a = ''
      OR approver_b = ''
  ) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TWO_PERSON_APPROVAL_REQUIRED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM nova.organisations organisations
    JOIN nova_owner_recovery_input input
      ON input.organisation_id = organisations.id
  ) INTO organisation_exists;
  IF NOT organisation_exists THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_ORGANISATION_NOT_FOUND';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM nova_auth."user" auth_users
    JOIN nova_owner_recovery_input input
      ON input.auth_user_id = auth_users.id
      AND input.email = lower(auth_users.email)
  ),
  COALESCE((
    SELECT auth_users."emailVerified"
    FROM nova_auth."user" auth_users
    JOIN nova_owner_recovery_input input
      ON input.auth_user_id = auth_users.id
      AND input.email = lower(auth_users.email)
  ), false)
  INTO auth_user_exists, auth_user_verified;
  IF NOT auth_user_exists OR NOT auth_user_verified THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_VERIFIED_AUTH_IDENTITY_REQUIRED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM nova.people people
    JOIN nova_owner_recovery_input input
      ON input.organisation_id = people.organisation_id
      AND input.email = people.email
  ) INTO existing_email;
  IF existing_email THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_EMAIL_ALREADY_IN_ORGANISATION';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM nova.roles roles
    JOIN nova_owner_recovery_input input
      ON input.organisation_id = roles.organisation_id
    WHERE roles.key = 'super_admin'
      AND roles.is_protected
      AND roles.archived_at IS NULL
  ) INTO protected_role_exists;
  IF NOT protected_role_exists THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_SUPER_ADMIN_ROLE_MISSING';
  END IF;
END;
$validation$;

INSERT INTO nova.people (organisation_id, email, display_name)
SELECT organisation_id, email, display_name
FROM nova_owner_recovery_input
RETURNING id AS nova_recovery_person_id \gset

UPDATE nova_owner_recovery_input
SET person_id = :'nova_recovery_person_id'::uuid;

INSERT INTO nova.person_identities (person_id, provider, subject)
SELECT person_id, 'better_auth', auth_user_id
FROM nova_owner_recovery_input;

INSERT INTO nova.person_status_periods (person_id, status, effective_at)
SELECT person_id, 'active', now()
FROM nova_owner_recovery_input;

INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
SELECT input.person_id, roles.id, current_date
FROM nova.roles roles
JOIN nova_owner_recovery_input input
  ON input.organisation_id = roles.organisation_id
WHERE roles.key = 'super_admin'
  AND roles.is_protected
  AND roles.archived_at IS NULL;

DO $assignment_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    JOIN nova_owner_recovery_input input
      ON input.person_id = assignments.person_id
    WHERE roles.key = 'super_admin'
      AND assignments.effective_until IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_ROLE_ASSIGNMENT_FAILED';
  END IF;
END;
$assignment_check$;

INSERT INTO nova.audit_events (
  organisation_id,
  actor_person_id,
  action,
  target_type,
  target_id,
  details
)
SELECT
  input.organisation_id,
  NULL,
  'organisation.owner_recovered',
  'person',
  input.person_id,
  jsonb_build_object(
    'incident_id', input.incident_id,
    'reason', input.reason,
    'approver_a', input.approver_a,
    'approver_b', input.approver_b,
    'identity_provider', 'better_auth',
    'recovery_mode', 'operator_break_glass'
  )
FROM nova_owner_recovery_input input;

COMMIT;

\echo 'Temporary owner recovery identity linked; transfer ownership through the normal NOVA command, then revoke this identity and its sessions.'
