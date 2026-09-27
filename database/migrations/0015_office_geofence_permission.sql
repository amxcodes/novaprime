-- Make office geofence administration independently assignable to configurable roles.

INSERT INTO nova.permissions (key, module, description)
VALUES (
  'availability.office_geofence.manage',
  'availability',
  'Create or update office attendance geofence settings.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, 'availability.office_geofence.manage', 'organisation'::nova.permission_scope
FROM nova.roles
WHERE roles.key = 'super_admin'
ON CONFLICT DO NOTHING;
