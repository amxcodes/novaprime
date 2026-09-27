-- NOVA auth delivery fallback. Better Auth remains the credential/session
-- authority; this table stores only an encrypted, one-time delivery handoff
-- when an email provider is intentionally unavailable.

CREATE TYPE nova.auth_handoff_purpose AS ENUM (
  'invitation',
  'verification',
  'password_reset'
);

CREATE TABLE nova.auth_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id) ON DELETE CASCADE,
  target_person_id uuid NOT NULL REFERENCES nova.people(id) ON DELETE CASCADE,
  target_identity_subject text,
  purpose nova.auth_handoff_purpose NOT NULL,
  url_ciphertext bytea NOT NULL,
  url_key_version smallint NOT NULL CHECK (url_key_version > 0),
  created_by_person_id uuid REFERENCES nova.people(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  expires_at timestamptz NOT NULL,
  revealed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (revealed_at IS NULL OR revealed_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (revealed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX auth_handoffs_open_lookup
  ON nova.auth_handoffs (organisation_id, purpose, created_at DESC)
  WHERE revealed_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX auth_handoffs_one_open_per_target
  ON nova.auth_handoffs (target_person_id, purpose)
  WHERE revealed_at IS NULL AND revoked_at IS NULL;

INSERT INTO nova.permissions (key, module, description) VALUES
  ('auth.manual_recovery', 'authentication', 'Generate and reveal one-time system handoff links when email delivery is unavailable.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, 'auth.manual_recovery', 'organisation'::nova.permission_scope
FROM nova.roles
WHERE roles.key = 'super_admin'
ON CONFLICT DO NOTHING;

ALTER TABLE nova.auth_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_handoffs_request_organisation ON nova.auth_handoffs
FOR ALL
USING (organisation_id = nova.request_organisation_id())
WITH CHECK (organisation_id = nova.request_organisation_id());

-- Auth callbacks run before a normal NOVA actor/request context exists. This
-- narrow function resolves the Better Auth identity to the NOVA person and
-- stages an encrypted handoff without making provider-specific claims part of
-- the domain or granting the caller broad table access.
CREATE FUNCTION nova.stage_auth_handoff(
  p_identity_subject text,
  p_purpose nova.auth_handoff_purpose,
  p_url_ciphertext bytea,
  p_url_key_version smallint,
  p_expires_at timestamptz,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  v_target_person_id uuid;
  v_organisation_id uuid;
  handoff_id uuid;
BEGIN
  IF btrim(p_identity_subject) = ''
    OR p_url_ciphertext IS NULL
    OR p_url_key_version IS NULL
    OR p_url_key_version < 1
    OR p_expires_at <= now()
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTH_HANDOFF_INPUT_INVALID';
  END IF;

  SELECT identities.person_id, people.organisation_id
  INTO v_target_person_id, v_organisation_id
  FROM nova.person_identities identities
  JOIN nova.people people ON people.id = identities.person_id
  WHERE identities.provider = 'better_auth'
    AND identities.subject = p_identity_subject
    AND identities.revoked_at IS NULL;

  IF v_target_person_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE nova.auth_handoffs
  SET revoked_at = now()
  WHERE auth_handoffs.target_person_id = v_target_person_id
    AND purpose = p_purpose
    AND revealed_at IS NULL
    AND revoked_at IS NULL;

  INSERT INTO nova.auth_handoffs (
    organisation_id,
    target_person_id,
    target_identity_subject,
    purpose,
    url_ciphertext,
    url_key_version,
    reason,
    expires_at
  )
  VALUES (
    v_organisation_id,
    v_target_person_id,
    p_identity_subject,
    p_purpose,
    p_url_ciphertext,
    p_url_key_version,
    btrim(p_reason),
    p_expires_at
  )
  RETURNING id INTO handoff_id;

  INSERT INTO nova.audit_events (
    organisation_id, actor_person_id, action, target_type, target_id, details
  )
  VALUES (
    v_organisation_id,
    NULL,
    'auth.handoff.staged',
    'auth_handoff',
    handoff_id,
    jsonb_build_object('purpose', p_purpose, 'target_person_id', v_target_person_id)
  );

  RETURN handoff_id;
END;
$$;

REVOKE ALL ON FUNCTION nova.stage_auth_handoff(text, nova.auth_handoff_purpose, bytea, smallint, timestamptz, text) FROM PUBLIC;
