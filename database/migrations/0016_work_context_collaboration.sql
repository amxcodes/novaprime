-- NOVA Phase 3 foundation: explicit collaboration context, tasks, assignments
-- and reviewer selection. Work sessions/review cycles remain additive later.

ALTER TYPE nova.permission_scope ADD VALUE IF NOT EXISTS 'client';
ALTER TYPE nova.permission_scope ADD VALUE IF NOT EXISTS 'client_workstream';
ALTER TYPE nova.permission_scope ADD VALUE IF NOT EXISTS 'group';
ALTER TYPE nova.permission_scope ADD VALUE IF NOT EXISTS 'assigned_work';

CREATE TYPE nova.task_status AS ENUM (
  'backlog', 'ready', 'in_progress', 'submitted', 'approved', 'done',
  'blocked', 'returned', 'cancelled'
);

CREATE TYPE nova.assignment_status AS ENUM (
  'assigned', 'in_progress', 'submitted', 'awaiting_review',
  'approved', 'changes_requested', 'cancelled'
);

CREATE TABLE nova.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.client_workstreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  client_id uuid NOT NULL REFERENCES nova.clients(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE TABLE nova.organisation_workstreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.work_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  client_workstream_id uuid REFERENCES nova.client_workstreams(id),
  organisation_workstream_id uuid REFERENCES nova.organisation_workstreams(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((client_workstream_id IS NOT NULL) <> (organisation_workstream_id IS NOT NULL)),
  UNIQUE (client_workstream_id, name),
  UNIQUE (organisation_workstream_id, name)
);

CREATE TABLE nova.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  client_workstream_id uuid REFERENCES nova.client_workstreams(id),
  organisation_workstream_id uuid REFERENCES nova.organisation_workstreams(id),
  work_group_id uuid REFERENCES nova.work_groups(id),
  organisation_department_id uuid REFERENCES nova.organisation_departments(id),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  status nova.task_status NOT NULL DEFAULT 'backlog',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date date,
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((client_workstream_id IS NOT NULL) <> (organisation_workstream_id IS NOT NULL))
);

CREATE TABLE nova.task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  task_id uuid NOT NULL REFERENCES nova.tasks(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  reviewer_person_id uuid REFERENCES nova.people(id),
  review_required boolean NOT NULL DEFAULT true,
  status nova.assignment_status NOT NULL DEFAULT 'assigned',
  assigned_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewer_person_id IS NULL OR reviewer_person_id <> person_id),
  UNIQUE (task_id, person_id)
);

CREATE INDEX clients_organisation_active ON nova.clients (organisation_id, archived_at);
CREATE INDEX client_workstreams_client_active ON nova.client_workstreams (client_id, archived_at);
CREATE INDEX organisation_workstreams_active ON nova.organisation_workstreams (organisation_id, archived_at);
CREATE INDEX work_groups_parent_active ON nova.work_groups (organisation_id, archived_at);
CREATE INDEX tasks_organisation_status ON nova.tasks (organisation_id, status, due_date);
CREATE INDEX task_assignments_person_status ON nova.task_assignments (person_id, status);

CREATE FUNCTION nova.validate_work_context_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  related_organisation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'clients' THEN
    IF NOT EXISTS (
      SELECT 1 FROM nova.people people
      WHERE people.id = NEW.created_by_person_id
        AND people.organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_ACTOR_ORGANISATION_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'client_workstreams' THEN
    SELECT organisation_id INTO related_organisation_id FROM nova.clients WHERE id = NEW.client_id;
    IF related_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_ORGANISATION_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'organisation_workstreams' THEN
    IF NOT EXISTS (
      SELECT 1 FROM nova.people people
      WHERE people.id = NEW.created_by_person_id
        AND people.organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_ACTOR_ORGANISATION_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'work_groups' THEN
    IF NEW.client_workstream_id IS NOT NULL THEN
      SELECT organisation_id INTO related_organisation_id FROM nova.client_workstreams WHERE id = NEW.client_workstream_id;
    ELSE
      SELECT organisation_id INTO related_organisation_id FROM nova.organisation_workstreams WHERE id = NEW.organisation_workstream_id;
    END IF;
    IF related_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_ORGANISATION_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.client_workstream_id IS NOT NULL THEN
      SELECT organisation_id INTO related_organisation_id FROM nova.client_workstreams WHERE id = NEW.client_workstream_id;
    ELSE
      SELECT organisation_id INTO related_organisation_id FROM nova.organisation_workstreams WHERE id = NEW.organisation_workstream_id;
    END IF;
    IF related_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_ORGANISATION_MISMATCH';
    END IF;
    IF NEW.organisation_department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM nova.organisation_departments departments
      WHERE departments.id = NEW.organisation_department_id
        AND departments.organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_DEPARTMENT_ORGANISATION_MISMATCH';
    END IF;
    IF NEW.work_group_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM nova.work_groups groups
      WHERE groups.id = NEW.work_group_id
        AND groups.organisation_id = NEW.organisation_id
        AND ((NEW.client_workstream_id IS NOT NULL AND groups.client_workstream_id = NEW.client_workstream_id)
          OR (NEW.organisation_workstream_id IS NOT NULL AND groups.organisation_workstream_id = NEW.organisation_workstream_id))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_GROUP_CONTEXT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'task_assignments' THEN
    SELECT organisation_id INTO related_organisation_id FROM nova.tasks WHERE id = NEW.task_id;
    IF related_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_ORGANISATION_MISMATCH';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM nova.people people
      WHERE people.id = NEW.person_id AND people.organisation_id = NEW.organisation_id
    ) OR (NEW.reviewer_person_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM nova.people people
      WHERE people.id = NEW.reviewer_person_id AND people.organisation_id = NEW.organisation_id
    )) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_CONTEXT_PERSON_ORGANISATION_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_validate_organisation
BEFORE INSERT OR UPDATE ON nova.clients
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_context_organisation();

CREATE TRIGGER client_workstreams_validate_organisation
BEFORE INSERT OR UPDATE ON nova.client_workstreams
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_context_organisation();

CREATE TRIGGER organisation_workstreams_validate_organisation
BEFORE INSERT OR UPDATE ON nova.organisation_workstreams
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_context_organisation();

CREATE TRIGGER work_groups_validate_organisation
BEFORE INSERT OR UPDATE ON nova.work_groups
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_context_organisation();

CREATE TRIGGER tasks_validate_organisation
BEFORE INSERT OR UPDATE ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_context_organisation();

CREATE TRIGGER task_assignments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.task_assignments
FOR EACH ROW EXECUTE FUNCTION nova.validate_work_context_organisation();

CREATE FUNCTION nova.work_context_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_touch_updated_at BEFORE UPDATE ON nova.clients
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();
CREATE TRIGGER client_workstreams_touch_updated_at BEFORE UPDATE ON nova.client_workstreams
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();
CREATE TRIGGER organisation_workstreams_touch_updated_at BEFORE UPDATE ON nova.organisation_workstreams
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();
CREATE TRIGGER work_groups_touch_updated_at BEFORE UPDATE ON nova.work_groups
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();
CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();
CREATE TRIGGER task_assignments_touch_updated_at BEFORE UPDATE ON nova.task_assignments
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();

-- Extend the canonical permission-grant shape for the new scopes.
ALTER TABLE nova.role_permission_grants
  ADD COLUMN client_id uuid REFERENCES nova.clients(id),
  ADD COLUMN client_workstream_id uuid REFERENCES nova.client_workstreams(id),
  ADD COLUMN group_id uuid REFERENCES nova.work_groups(id),
  ADD CONSTRAINT role_permission_grants_work_context_shape CHECK (
    (scope::text IN ('organisation', 'own_record', 'assigned_work')
      AND office_id IS NULL AND organisation_department_id IS NULL
      AND client_id IS NULL AND client_workstream_id IS NULL AND group_id IS NULL)
    OR (scope::text = 'office' AND office_id IS NOT NULL
      AND organisation_department_id IS NULL AND client_id IS NULL
      AND client_workstream_id IS NULL AND group_id IS NULL)
    OR (scope::text = 'organisation_department' AND office_id IS NULL
      AND organisation_department_id IS NOT NULL AND client_id IS NULL
      AND client_workstream_id IS NULL AND group_id IS NULL)
    OR (scope::text = 'client' AND office_id IS NULL
      AND organisation_department_id IS NULL AND client_id IS NOT NULL
      AND client_workstream_id IS NULL AND group_id IS NULL)
    OR (scope::text = 'client_workstream' AND office_id IS NULL
      AND organisation_department_id IS NULL AND client_id IS NULL
      AND client_workstream_id IS NOT NULL AND group_id IS NULL)
    OR (scope::text = 'group' AND office_id IS NULL
      AND organisation_department_id IS NULL AND client_id IS NULL
      AND client_workstream_id IS NULL AND group_id IS NOT NULL)
  );

DO $$
DECLARE
  constraint_name text;
BEGIN
  -- 0001's generated CHECK is named role_permission_grants_check in the
  -- canonical schema. Drop it explicitly; the catalog fallback below also
  -- handles installations where PostgreSQL chose a different name.
  ALTER TABLE nova.role_permission_grants
    DROP CONSTRAINT IF EXISTS role_permission_grants_check;
  FOR constraint_name IN
    SELECT pg_constraint.conname
    FROM pg_constraint
    WHERE pg_constraint.conrelid = 'nova.role_permission_grants'::regclass
      AND pg_constraint.contype = 'c'
      AND pg_get_constraintdef(pg_constraint.oid) LIKE '%scope IN%'
  LOOP
    EXECUTE format('ALTER TABLE nova.role_permission_grants DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

DROP INDEX nova.role_permission_grant_unique_scope;
CREATE UNIQUE INDEX role_permission_grant_unique_scope
  ON nova.role_permission_grants (
    role_id,
    permission_key,
    scope,
    COALESCE(office_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(organisation_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(client_workstream_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE FUNCTION nova.validate_permission_grant_work_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_organisation_id uuid;
  related_organisation_id uuid;
BEGIN
  SELECT organisation_id INTO role_organisation_id FROM nova.roles WHERE id = NEW.role_id;
  IF NEW.client_id IS NOT NULL THEN
    SELECT organisation_id INTO related_organisation_id FROM nova.clients WHERE id = NEW.client_id;
  ELSIF NEW.client_workstream_id IS NOT NULL THEN
    SELECT organisation_id INTO related_organisation_id FROM nova.client_workstreams WHERE id = NEW.client_workstream_id;
  ELSIF NEW.group_id IS NOT NULL THEN
    SELECT organisation_id INTO related_organisation_id FROM nova.work_groups WHERE id = NEW.group_id;
  END IF;
  IF related_organisation_id IS NOT NULL AND related_organisation_id IS DISTINCT FROM role_organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PERMISSION_SCOPE_ORGANISATION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permission_grants_validate_work_context
BEFORE INSERT OR UPDATE ON nova.role_permission_grants
FOR EACH ROW EXECUTE FUNCTION nova.validate_permission_grant_work_context();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('workstreams.view', 'work_context', 'View client and organisation workstreams within the granted scope.'),
  ('workstreams.create', 'work_context', 'Create client and organisation workstreams.'),
  ('workstreams.edit', 'work_context', 'Edit or archive workstreams within the granted scope.'),
  ('groups.view', 'work_context', 'View groups within the granted workstream scope.'),
  ('groups.create', 'work_context', 'Create groups within the granted workstream scope.'),
  ('groups.edit', 'work_context', 'Edit or archive groups within the granted workstream scope.'),
  ('tasks.reviewer_manage', 'work_context', 'Assign or change task reviewers within the granted work scope.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN (
    'clients.view', 'clients.create', 'clients.edit',
    'workstreams.view', 'workstreams.create', 'workstreams.edit',
    'groups.view', 'groups.create', 'groups.edit',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign',
    'tasks.reassign', 'tasks.start', 'tasks.submit', 'tasks.review', 'tasks.reviewer_manage'
  )
ON CONFLICT DO NOTHING;

ALTER TABLE nova.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.client_workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.organisation_workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.work_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.task_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_request_organisation ON nova.clients FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY client_workstreams_request_organisation ON nova.client_workstreams FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY organisation_workstreams_request_organisation ON nova.organisation_workstreams FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY work_groups_request_organisation ON nova.work_groups FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY tasks_request_organisation ON nova.tasks FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY task_assignments_request_organisation ON nova.task_assignments FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
