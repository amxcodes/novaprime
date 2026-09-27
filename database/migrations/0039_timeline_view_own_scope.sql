-- Employees must be able to view their own unified timeline without granting
-- organisation-wide visibility. Keep this in the canonical scope catalogue.

UPDATE nova.permissions
SET allowed_scopes = array_append(allowed_scopes, 'own_record'::nova.permission_scope)
WHERE key = 'work.timeline.view'
  AND NOT ('own_record'::nova.permission_scope = ANY(allowed_scopes));
