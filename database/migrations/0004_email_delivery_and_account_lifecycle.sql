-- NOVA Phase 1: portable email delivery configuration and account lifecycle gates.
-- Provider credentials are encrypted by NOVA application code before storage. This
-- schema deliberately contains no Supabase-specific configuration or secrets.

CREATE TYPE nova.email_provider_kind AS ENUM (
  'console',
  'smtp',
  'gmail_oauth2',
  'resend'
);

CREATE TABLE nova.email_provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  provider nova.email_provider_kind NOT NULL,
  sender_email text NOT NULL CHECK (sender_email = lower(sender_email) AND btrim(sender_email) <> ''),
  reply_to_email text CHECK (reply_to_email IS NULL OR (reply_to_email = lower(reply_to_email) AND btrim(reply_to_email) <> '')),
  credentials_ciphertext bytea,
  credentials_key_version smallint,
  is_active boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  last_test_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (provider = 'console' AND credentials_ciphertext IS NULL AND credentials_key_version IS NULL)
    OR (provider <> 'console' AND credentials_ciphertext IS NOT NULL AND credentials_key_version IS NOT NULL)
  ),
  UNIQUE (name)
);

CREATE UNIQUE INDEX one_active_email_provider_connection
  ON nova.email_provider_connections ((is_active))
  WHERE is_active;

CREATE TABLE nova.email_oauth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES nova.email_provider_connections(id) ON DELETE CASCADE,
  initiator_person_id uuid NOT NULL REFERENCES nova.people(id),
  state_hash bytea NOT NULL UNIQUE,
  pkce_verifier_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

ALTER TABLE nova.person_invitations
  ADD COLUMN pending_identity_subject text,
  ADD COLUMN claimed_at timestamptz;

CREATE UNIQUE INDEX person_invitations_pending_identity_subject
  ON nova.person_invitations (pending_identity_subject)
  WHERE pending_identity_subject IS NOT NULL;

INSERT INTO nova.permissions (key, module, description) VALUES
  ('people.invite', 'people', 'Invite people into organisation onboarding.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, 'people.invite', 'organisation'::nova.permission_scope
FROM nova.roles
WHERE roles.key = 'super_admin'
ON CONFLICT DO NOTHING;

-- Email connection credentials are deployment infrastructure. They are visible
-- through NOVA commands only to a protected Super Admin, never directly to a
-- browser or ordinary custom role.
CREATE FUNCTION nova.request_actor_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    WHERE assignments.person_id = nova.request_user_id()
      AND assignments.effective_on <= current_date
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= current_date)
      AND roles.key = 'super_admin'
      AND roles.is_protected
      AND roles.archived_at IS NULL
  );
$$;

ALTER TABLE nova.email_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.email_oauth_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_provider_connections_super_admin ON nova.email_provider_connections
FOR ALL
USING (nova.request_actor_is_super_admin())
WITH CHECK (nova.request_actor_is_super_admin());

CREATE POLICY email_oauth_attempts_super_admin ON nova.email_oauth_attempts
FOR ALL
USING (nova.request_actor_is_super_admin())
WITH CHECK (nova.request_actor_is_super_admin());

-- Better Auth and the NOVA invitation sender need the active configuration
-- outside a user-originated RLS transaction. The application role receives
-- encrypted bytes only; the decryption key remains deployment-only.
CREATE FUNCTION nova.active_email_provider_connection()
RETURNS TABLE (
  connection_id uuid,
  provider nova.email_provider_kind,
  sender_email text,
  reply_to_email text,
  credentials_ciphertext bytea,
  credentials_key_version smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT
    connections.id,
    connections.provider,
    connections.sender_email,
    connections.reply_to_email,
    connections.credentials_ciphertext,
    connections.credentials_key_version
  FROM nova.email_provider_connections connections
  WHERE connections.is_active
  LIMIT 1;
$$;

-- The OAuth callback proves possession of the opaque state. It can consume an
-- attempt exactly once and receives only encrypted configuration and PKCE data.
CREATE FUNCTION nova.consume_email_oauth_attempt(p_state_hash bytea)
RETURNS TABLE (
  connection_id uuid,
  initiator_person_id uuid,
  organisation_id uuid,
  credentials_ciphertext bytea,
  credentials_key_version smallint,
  pkce_verifier_ciphertext bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE nova.email_oauth_attempts attempts
  SET consumed_at = now()
  FROM nova.email_provider_connections connections,
       nova.people people
  WHERE attempts.connection_id = connections.id
    AND people.id = attempts.initiator_person_id
    AND attempts.state_hash = p_state_hash
    AND attempts.expires_at > now()
    AND attempts.consumed_at IS NULL
    AND connections.provider = 'gmail_oauth2'
  RETURNING
    connections.id,
    attempts.initiator_person_id,
    people.organisation_id,
    connections.credentials_ciphertext,
    connections.credentials_key_version,
    attempts.pkce_verifier_ciphertext;
END;
$$;

-- A Better Auth account may be created only by NOVA's controlled invitation
-- route. Linking it early keeps the domain identity stable; normal command
-- access remains impossible until email verification moves the person from
-- Invited to Onboarding.
CREATE FUNCTION nova.claim_invitation_identity(
  p_identity_subject text,
  p_invitee_email text,
  p_token_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  invitation_id uuid;
  invited_person_id uuid;
  linked_person_id uuid;
BEGIN
  IF btrim(p_identity_subject) = ''
    OR btrim(p_invitee_email) = ''
    OR p_invitee_email <> lower(p_invitee_email) THEN
    RETURN false;
  END IF;

  SELECT invitations.id, invitations.person_id
  INTO invitation_id, invited_person_id
  FROM nova.person_invitations invitations
  WHERE invitations.invitee_email = p_invitee_email
    AND invitations.token_hash = p_token_hash
    AND invitations.accepted_at IS NULL
    AND invitations.revoked_at IS NULL
    AND invitations.expires_at > now()
    AND (
      invitations.pending_identity_subject IS NULL
      OR invitations.pending_identity_subject = p_identity_subject
    )
  FOR UPDATE;

  IF invitation_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT identities.person_id
  INTO linked_person_id
  FROM nova.person_identities identities
  WHERE identities.provider = 'better_auth'
    AND identities.subject = p_identity_subject
    AND identities.revoked_at IS NULL;

  IF linked_person_id IS NOT NULL AND linked_person_id <> invited_person_id THEN
    RETURN false;
  END IF;

  IF linked_person_id IS NULL THEN
    INSERT INTO nova.person_identities (person_id, provider, subject)
    VALUES (invited_person_id, 'better_auth', p_identity_subject);
  END IF;

  UPDATE nova.person_invitations
  SET pending_identity_subject = p_identity_subject,
      claimed_at = COALESCE(claimed_at, now())
  WHERE id = invitation_id;

  RETURN true;
END;
$$;

CREATE FUNCTION nova.invitation_is_claimable(
  p_invitee_email text,
  p_token_hash bytea
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.person_invitations invitations
    WHERE invitations.invitee_email = p_invitee_email
      AND invitations.token_hash = p_token_hash
      AND invitations.accepted_at IS NULL
      AND invitations.revoked_at IS NULL
      AND invitations.expires_at > now()
      AND invitations.pending_identity_subject IS NULL
  );
$$;

-- Before the first organisation exists, the deployment-only bootstrap token is
-- the sole authority that may create the founding Better Auth account.
CREATE FUNCTION nova.bootstrap_auth_signup_available()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM nova.organisations);
$$;

CREATE FUNCTION nova.complete_invitation_after_email_verification(
  p_identity_subject text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  invitation_id uuid;
  v_person_id uuid;
  v_organisation_id uuid;
  v_current_effective_at timestamptz;
  v_transition_at timestamptz;
BEGIN
  SELECT
    invitations.id,
    invitations.person_id,
    people.organisation_id,
    status_periods.effective_at
  INTO
    invitation_id,
    v_person_id,
    v_organisation_id,
    v_current_effective_at
  FROM nova.person_invitations invitations
  JOIN nova.people people ON people.id = invitations.person_id
  JOIN nova_auth."user" users ON users.id = p_identity_subject
  JOIN nova.person_status_periods status_periods
    ON status_periods.person_id = people.id
    AND status_periods.ended_at IS NULL
  WHERE invitations.pending_identity_subject = p_identity_subject
    AND invitations.accepted_at IS NULL
    AND invitations.revoked_at IS NULL
    AND invitations.claimed_at IS NOT NULL
    AND users."emailVerified"
    AND users.email = invitations.invitee_email
    AND status_periods.status = 'invited'
  FOR UPDATE OF invitations, status_periods;

  IF invitation_id IS NULL THEN
    RETURN false;
  END IF;

  v_transition_at := GREATEST(
    clock_timestamp(),
    v_current_effective_at + interval '1 microsecond'
  );

  UPDATE nova.person_status_periods
  SET ended_at = v_transition_at
  WHERE person_status_periods.person_id = v_person_id
    AND ended_at IS NULL;

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (v_person_id, 'onboarding', v_transition_at);

  UPDATE nova.person_invitations
  SET accepted_at = now()
  WHERE id = invitation_id;

  INSERT INTO nova.audit_events (
    organisation_id, actor_person_id, action, target_type, target_id, details
  ) VALUES (
    v_organisation_id,
    v_person_id,
    'people.invitation.accepted',
    'person_invitation',
    invitation_id,
    jsonb_build_object('identity_provider', 'better_auth')
  );

  RETURN true;
END;
$$;

-- The existing resolver stays available to deployed commands. This companion
-- exposes lifecycle state so every future normal command can reject non-active
-- actors before it establishes its RLS transaction.
CREATE FUNCTION nova.resolve_authenticated_actor_state(p_identity_subject text)
RETURNS TABLE (
  user_id uuid,
  organisation_id uuid,
  status nova.person_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT people.id, people.organisation_id, status_periods.status
  FROM nova.person_identities identities
  JOIN nova.people people ON people.id = identities.person_id
  JOIN nova.person_status_periods status_periods
    ON status_periods.person_id = people.id
    AND status_periods.ended_at IS NULL
  WHERE identities.provider = 'better_auth'
    AND identities.subject = p_identity_subject
    AND identities.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION nova.request_actor_is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.active_email_provider_connection() FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.consume_email_oauth_attempt(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.claim_invitation_identity(text, text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.invitation_is_claimable(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.bootstrap_auth_signup_available() FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.complete_invitation_after_email_verification(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.resolve_authenticated_actor_state(text) FROM PUBLIC;
