-- Public links are tenant-selectable only inside an operator-approved origin
-- allowlist. The allowlist itself remains deployment configuration; this
-- table never grants a tenant the ability to introduce an arbitrary host.
CREATE TABLE nova.organisation_runtime_settings (
  organisation_id uuid PRIMARY KEY REFERENCES nova.organisations(id) ON DELETE CASCADE,
  public_origin text,
  updated_by_person_id uuid REFERENCES nova.people(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    public_origin IS NULL
    OR (
      char_length(btrim(public_origin)) BETWEEN 10 AND 500
      AND public_origin !~ '[[:space:]]'
      AND public_origin ~ '^https?://[^/?#]+$'
    )
  )
);

CREATE INDEX organisation_runtime_settings_updated_at
  ON nova.organisation_runtime_settings (updated_at DESC);

INSERT INTO nova.permissions (key, module, description) VALUES
  ('organisation.public_origin.manage', 'organisation', 'Choose the deployment-approved public origin used for NOVA links and email callbacks.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, 'organisation.public_origin.manage', 'organisation'::nova.permission_scope
FROM nova.roles
WHERE roles.key = 'super_admin'
ON CONFLICT DO NOTHING;

ALTER TABLE nova.organisation_runtime_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY organisation_runtime_settings_request_organisation
ON nova.organisation_runtime_settings
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

-- Better Auth callbacks and background workers may run before a normal request
-- context exists. These narrow functions expose only the public origin value;
-- they do not grant table access or evaluate domain permissions.
CREATE FUNCTION nova.public_origin_for_organisation(p_organisation_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT public_origin
  FROM nova.organisation_runtime_settings
  WHERE organisation_id = p_organisation_id;
$$;

CREATE FUNCTION nova.public_origin_for_identity(p_identity_subject text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT settings.public_origin
  FROM nova.person_identities identities
  JOIN nova.people people ON people.id = identities.person_id
  JOIN nova.organisation_runtime_settings settings
    ON settings.organisation_id = people.organisation_id
  WHERE identities.provider = 'better_auth'
    AND identities.subject = p_identity_subject
    AND identities.revoked_at IS NULL;
$$;

CREATE FUNCTION nova.configured_public_origins()
RETURNS TABLE (origin text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT DISTINCT public_origin
  FROM nova.organisation_runtime_settings
  WHERE public_origin IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION nova.public_origin_for_organisation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.public_origin_for_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.configured_public_origins() FROM PUBLIC;
