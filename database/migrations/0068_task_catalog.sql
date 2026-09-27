-- Reusable task defaults stay separate from task execution and authorization.
CREATE TYPE nova.task_catalog_proposal_action AS ENUM ('create', 'update', 'archive');
CREATE TYPE nova.task_catalog_proposal_status AS ENUM ('pending', 'approved', 'rejected', 'stale');

CREATE TABLE nova.task_catalog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 320),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  billing_class nova.task_billing_class NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);

CREATE UNIQUE INDEX task_catalog_entries_active_title
  ON nova.task_catalog_entries (organisation_id, lower(title))
  WHERE archived_at IS NULL;

CREATE TABLE nova.task_catalog_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  catalog_entry_id uuid,
  action nova.task_catalog_proposal_action NOT NULL,
  expected_revision integer CHECK (expected_revision IS NULL OR expected_revision > 0),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 320),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  billing_class nova.task_billing_class NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  status nova.task_catalog_proposal_status NOT NULL DEFAULT 'pending',
  proposed_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  reviewed_by_person_id uuid REFERENCES nova.people(id),
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  FOREIGN KEY (organisation_id, catalog_entry_id)
    REFERENCES nova.task_catalog_entries (organisation_id, id),
  CHECK (
    (action = 'create' AND catalog_entry_id IS NULL AND expected_revision IS NULL)
    OR (action IN ('update', 'archive') AND catalog_entry_id IS NOT NULL AND expected_revision IS NOT NULL)
  ),
  CHECK (
    (status = 'pending' AND reviewed_by_person_id IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by_person_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  UNIQUE (organisation_id, id)
);

CREATE INDEX task_catalog_proposals_pending
  ON nova.task_catalog_proposals (organisation_id, created_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX task_catalog_proposals_pending_create_title
  ON nova.task_catalog_proposals (organisation_id, lower(title))
  WHERE status = 'pending' AND action = 'create';

CREATE FUNCTION nova.advance_task_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF ROW(NEW.title, NEW.description, NEW.billing_class, NEW.priority, NEW.archived_at)
      IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.billing_class, OLD.priority, OLD.archived_at) THEN
    IF NEW.revision IS DISTINCT FROM OLD.revision THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_REVISION_IMMUTABLE';
    END IF;
    NEW.revision := OLD.revision + 1;
  ELSIF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_REVISION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_catalog_entries_advance_revision
BEFORE UPDATE ON nova.task_catalog_entries
FOR EACH ROW EXECUTE FUNCTION nova.advance_task_catalog_revision();
CREATE TRIGGER task_catalog_entries_touch_updated_at
BEFORE UPDATE ON nova.task_catalog_entries
FOR EACH ROW EXECUTE FUNCTION nova.work_context_touch_updated_at();

CREATE FUNCTION nova.guard_task_catalog_proposal_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF ROW(NEW.organisation_id, NEW.catalog_entry_id, NEW.action, NEW.expected_revision,
         NEW.title, NEW.description, NEW.billing_class, NEW.priority, NEW.reason, NEW.proposed_by_person_id)
      IS DISTINCT FROM ROW(OLD.organisation_id, OLD.catalog_entry_id, OLD.action, OLD.expected_revision,
         OLD.title, OLD.description, OLD.billing_class, OLD.priority, OLD.reason, OLD.proposed_by_person_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROPOSAL_IMMUTABLE';
  END IF;
  IF OLD.status <> 'pending' OR NEW.status = 'pending'
     OR NEW.reviewed_by_person_id IS NULL OR NEW.reviewed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROPOSAL_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_catalog_proposals_guard_update
BEFORE UPDATE ON nova.task_catalog_proposals
FOR EACH ROW EXECUTE FUNCTION nova.guard_task_catalog_proposal_update();

CREATE FUNCTION nova.validate_task_catalog_organisation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  actor_id uuid;
  related_organisation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'task_catalog_entries' THEN
    actor_id := NEW.created_by_person_id;
  ELSE
    actor_id := NEW.proposed_by_person_id;
    IF NEW.reviewed_by_person_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM nova.people people
      WHERE people.id = NEW.reviewed_by_person_id
        AND people.organisation_id = NEW.organisation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_ACTOR_ORGANISATION_MISMATCH';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nova.people people
    WHERE people.id = actor_id AND people.organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_ACTOR_ORGANISATION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_catalog_entries_validate_organisation
BEFORE INSERT OR UPDATE ON nova.task_catalog_entries
FOR EACH ROW EXECUTE FUNCTION nova.validate_task_catalog_organisation();
CREATE TRIGGER task_catalog_proposals_validate_organisation
BEFORE INSERT OR UPDATE ON nova.task_catalog_proposals
FOR EACH ROW EXECUTE FUNCTION nova.validate_task_catalog_organisation();

ALTER TABLE nova.tasks
  ADD COLUMN task_catalog_entry_id uuid,
  ADD COLUMN task_catalog_revision integer,
  ADD CONSTRAINT tasks_task_catalog_provenance_shape CHECK (
    (task_catalog_entry_id IS NULL AND task_catalog_revision IS NULL)
    OR (task_catalog_entry_id IS NOT NULL AND task_catalog_revision > 0)
  ),
  ADD CONSTRAINT tasks_task_catalog_entry_same_organisation
    FOREIGN KEY (organisation_id, task_catalog_entry_id)
    REFERENCES nova.task_catalog_entries (organisation_id, id);

ALTER TABLE nova.task_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.task_catalog_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_catalog_entries_request_organisation ON nova.task_catalog_entries FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY task_catalog_proposals_request_organisation ON nova.task_catalog_proposals FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());

INSERT INTO nova.permissions (key, module, description, allowed_scopes) VALUES
  ('tasks.catalog.view', 'work_context', 'Use approved reusable task defaults within the organisation.', ARRAY['organisation']::nova.permission_scope[]),
  ('tasks.catalog.propose', 'work_context', 'Propose additions or changes to the reusable task catalogue.', ARRAY['organisation']::nova.permission_scope[]),
  ('tasks.catalog.manage', 'work_context', 'Create, edit, and archive approved reusable task defaults.', ARRAY['organisation']::nova.permission_scope[]),
  ('tasks.catalog.review', 'work_context', 'Approve or reject reusable task catalogue proposals.', ARRAY['organisation']::nova.permission_scope[])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  description = EXCLUDED.description,
  allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles roles
CROSS JOIN nova.permissions permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN (
    'tasks.catalog.view', 'tasks.catalog.propose',
    'tasks.catalog.manage', 'tasks.catalog.review'
  )
ON CONFLICT DO NOTHING;
