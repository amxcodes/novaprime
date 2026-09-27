-- A client-scoped role may create tasks within that client's workstreams.
-- Keep the catalogue aligned with the target context evaluated by the API.

UPDATE nova.permissions
SET allowed_scopes = ARRAY['organisation', 'client', 'client_workstream', 'group']::nova.permission_scope[]
WHERE key = 'tasks.create';
