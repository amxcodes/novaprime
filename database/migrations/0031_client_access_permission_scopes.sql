-- Client access administration can be delegated to an organisation or a
-- specific client; keep the permission-scope catalogue authoritative.
UPDATE nova.permissions
SET allowed_scopes = ARRAY['organisation', 'client']::nova.permission_scope[]
WHERE key IN ('clients.departments.manage', 'clients.members.manage');
