-- NOVA Phase 1: the minimum authority needed for the first real admin command.

INSERT INTO nova.permissions (key, module, description) VALUES
  ('roles.view', 'people', 'View organisation role configuration.'),
  ('roles.create', 'people', 'Create organisation custom roles.'),
  ('roles.edit', 'people', 'Edit organisation custom roles.'),
  ('roles.assign', 'people', 'Assign organisation roles to people.')
ON CONFLICT (key) DO NOTHING;

-- Existing and newly bootstrapped Super Admin roles retain the PRD-mandated
-- authority to configure custom roles as the product permission catalogue grows.
INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('roles.view', 'roles.create', 'roles.edit', 'roles.assign')
ON CONFLICT DO NOTHING;

-- The API authenticates the Better Auth subject before it calls this function.
-- This narrowly exposes the provider-to-domain mapping needed to establish the
-- transaction-local RLS context; it does not grant any domain action.
CREATE FUNCTION nova.resolve_authenticated_actor(p_identity_subject text)
RETURNS TABLE (user_id uuid, organisation_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT people.id, people.organisation_id
  FROM nova.person_identities identities
  JOIN nova.people people ON people.id = identities.person_id
  WHERE identities.provider = 'better_auth'
    AND identities.subject = p_identity_subject
    AND identities.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION nova.resolve_authenticated_actor(text) FROM PUBLIC;
