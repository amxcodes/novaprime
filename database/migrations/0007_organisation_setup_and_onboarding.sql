-- Phase 1: organisation structure and the atomic completion of a person's
-- required onboarding setup. PostgreSQL remains the portable canonical model.

ALTER TABLE nova.offices
  ADD COLUMN location text;

ALTER TABLE nova.offices
  ADD CONSTRAINT offices_location_not_blank
  CHECK (location IS NULL OR btrim(location) <> '');

INSERT INTO nova.permissions (key, module, description) VALUES
  ('organisation.settings.manage', 'organisation', 'Manage offices and organisation departments.'),
  ('people.activate', 'people', 'Complete a person onboarding into Active status.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('organisation.settings.manage', 'people.activate')
ON CONFLICT DO NOTHING;
