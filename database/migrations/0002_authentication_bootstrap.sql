-- NOVA Phase 1: embedded authentication storage and the one-time organisation bootstrap.
-- Better Auth v1.7.5 owns only this separate infrastructure schema. NOVA owns
-- identities, roles, permissions, policy, and every domain authorization decision.

CREATE SCHEMA IF NOT EXISTS nova_auth;

CREATE TABLE nova_auth."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE nova_auth.session (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES nova_auth."user"(id) ON DELETE CASCADE
);

CREATE INDEX session_user_id_idx ON nova_auth.session ("userId");

CREATE TABLE nova_auth.account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES nova_auth."user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE INDEX account_user_id_idx ON nova_auth.account ("userId");

CREATE TABLE nova_auth.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE INDEX verification_identifier_idx ON nova_auth.verification (identifier);

-- This is the sole controlled RLS exception for initial deployment setup. The
-- API proves the Better Auth session and setup token before invoking it. The
-- function succeeds exactly once and remains unavailable to PUBLIC callers.
CREATE FUNCTION nova.bootstrap_organisation(
  p_organisation_name text,
  p_person_email text,
  p_person_display_name text,
  p_identity_subject text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  organisation_id uuid;
  person_id uuid;
  super_admin_role_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('nova.bootstrap_organisation'));

  IF EXISTS (SELECT 1 FROM nova.organisations) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED';
  END IF;

  IF btrim(p_organisation_name) = ''
    OR btrim(p_person_email) = ''
    OR p_person_email <> lower(p_person_email)
    OR btrim(p_person_display_name) = ''
    OR btrim(p_identity_subject) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ORGANISATION_BOOTSTRAP_INPUT_INVALID';
  END IF;

  INSERT INTO nova.organisations (name)
  VALUES (btrim(p_organisation_name))
  RETURNING id INTO organisation_id;

  INSERT INTO nova.roles (organisation_id, key, name, is_protected)
  VALUES (organisation_id, 'super_admin', 'Super Admin', true)
  RETURNING id INTO super_admin_role_id;

  INSERT INTO nova.role_operational_policies (role_id)
  VALUES (super_admin_role_id);

  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
  SELECT super_admin_role_id, key, 'organisation'::nova.permission_scope
  FROM nova.permissions;

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (organisation_id, p_person_email, btrim(p_person_display_name))
  RETURNING id INTO person_id;

  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (person_id, 'better_auth', p_identity_subject);

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (person_id, 'active', now());

  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (person_id, super_admin_role_id, current_date);

  INSERT INTO nova.audit_events (
    organisation_id,
    actor_person_id,
    action,
    target_type,
    target_id,
    details
  )
  VALUES (
    organisation_id,
    person_id,
    'organisation.bootstrap',
    'organisation',
    organisation_id,
    jsonb_build_object('identity_provider', 'better_auth')
  );

  RETURN organisation_id;
END;
$$;

REVOKE ALL ON FUNCTION nova.bootstrap_organisation(text, text, text, text) FROM PUBLIC;
