-- Align collaboration permission scopes with the targets evaluated by the
-- work-context command layer. This is additive: existing organisation grants
-- remain valid while narrower delegation becomes usable.

UPDATE nova.permissions
SET allowed_scopes = CASE key
  WHEN 'workstreams.create' THEN ARRAY['organisation', 'client']::nova.permission_scope[]
  WHEN 'workstreams.view' THEN ARRAY['organisation', 'client', 'client_workstream']::nova.permission_scope[]
  WHEN 'workstreams.edit' THEN ARRAY['organisation', 'client', 'client_workstream']::nova.permission_scope[]
  WHEN 'groups.create' THEN ARRAY['organisation', 'client_workstream']::nova.permission_scope[]
  WHEN 'groups.view' THEN ARRAY['organisation', 'client_workstream', 'group']::nova.permission_scope[]
  WHEN 'groups.edit' THEN ARRAY['organisation', 'client_workstream', 'group']::nova.permission_scope[]
  WHEN 'tasks.create' THEN ARRAY['organisation', 'client_workstream', 'group']::nova.permission_scope[]
  WHEN 'tasks.reviewer_manage' THEN ARRAY['organisation', 'client_workstream', 'group', 'assigned_work']::nova.permission_scope[]
  ELSE allowed_scopes
END
WHERE key IN (
  'workstreams.create', 'workstreams.view', 'workstreams.edit',
  'groups.create', 'groups.view', 'groups.edit',
  'tasks.create', 'tasks.reviewer_manage'
);
