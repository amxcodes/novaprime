-- Billing is derived from task work context, never from task text or catalog entries.
-- Existing task classes are retained as historical snapshots; existing client
-- workstreams require an authorized operator to configure future-task policy.

ALTER TABLE nova.client_workstreams
  ADD COLUMN billing_policy_class nova.task_billing_class,
  ADD COLUMN billing_policy_revision integer NOT NULL DEFAULT 0 CHECK (billing_policy_revision >= 0),
  ADD COLUMN billing_policy_set_by_person_id uuid REFERENCES nova.people(id),
  ADD COLUMN billing_policy_set_at timestamptz,
  ADD CONSTRAINT client_workstreams_billing_policy_shape CHECK (
    (billing_policy_class IS NULL AND billing_policy_revision = 0
      AND billing_policy_set_by_person_id IS NULL AND billing_policy_set_at IS NULL)
    OR (billing_policy_class IS NOT NULL AND billing_policy_revision > 0
      AND billing_policy_set_by_person_id IS NOT NULL AND billing_policy_set_at IS NOT NULL)
  );

ALTER TABLE nova.task_catalog_entries DROP COLUMN billing_class;
ALTER TABLE nova.task_catalog_proposals DROP COLUMN billing_class;

ALTER TABLE nova.tasks
  ADD COLUMN billing_policy_source text NOT NULL DEFAULT 'legacy_snapshot'
    CHECK (billing_policy_source IN ('client_workstream', 'organisation_default', 'legacy_snapshot')),
  ADD COLUMN billing_policy_revision integer NOT NULL DEFAULT 0 CHECK (billing_policy_revision >= 0),
  ADD CONSTRAINT tasks_billing_policy_provenance_shape CHECK (
    (billing_policy_source = 'legacy_snapshot' AND billing_policy_revision = 0)
    OR (billing_policy_source <> 'legacy_snapshot' AND billing_policy_revision > 0)
  );

CREATE FUNCTION nova.guard_client_workstream_billing_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.billing_policy_class IS NOT NULL
       OR NEW.billing_policy_revision <> 0
       OR NEW.billing_policy_set_by_person_id IS NOT NULL
       OR NEW.billing_policy_set_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_POLICY_MUST_USE_AUTHORIZED_UPDATE';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.billing_policy_revision, NEW.billing_policy_set_by_person_id, NEW.billing_policy_set_at)
      IS DISTINCT FROM ROW(OLD.billing_policy_revision, OLD.billing_policy_set_by_person_id, OLD.billing_policy_set_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_POLICY_PROVENANCE_SERVER_ASSIGNED';
  END IF;

  IF NEW.billing_policy_class IS DISTINCT FROM OLD.billing_policy_class THEN
    IF NOT nova.request_has_valid_actor()
       OR NEW.organisation_id IS DISTINCT FROM nova.request_organisation_id()
       OR NOT EXISTS (
         SELECT 1 FROM nova.people people
         WHERE people.id = nova.request_user_id()
           AND people.organisation_id = NEW.organisation_id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_POLICY_ACTOR_INVALID';
    END IF;
    NEW.billing_policy_revision := OLD.billing_policy_revision + 1;
    NEW.billing_policy_set_by_person_id := nova.request_user_id();
    NEW.billing_policy_set_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_workstreams_billing_policy_guard
BEFORE INSERT OR UPDATE ON nova.client_workstreams
FOR EACH ROW EXECUTE FUNCTION nova.guard_client_workstream_billing_policy();

CREATE OR REPLACE FUNCTION nova.advance_task_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF ROW(NEW.title, NEW.description, NEW.priority, NEW.archived_at)
      IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.priority, OLD.archived_at) THEN
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

CREATE OR REPLACE FUNCTION nova.guard_task_catalog_proposal_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF ROW(NEW.organisation_id, NEW.catalog_entry_id, NEW.action, NEW.expected_revision,
         NEW.title, NEW.description, NEW.priority, NEW.reason, NEW.proposed_by_person_id)
      IS DISTINCT FROM ROW(OLD.organisation_id, OLD.catalog_entry_id, OLD.action, OLD.expected_revision,
         OLD.title, OLD.description, OLD.priority, OLD.reason, OLD.proposed_by_person_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROPOSAL_IMMUTABLE';
  END IF;
  IF OLD.status <> 'pending' OR NEW.status = 'pending'
     OR NEW.reviewed_by_person_id IS NULL OR NEW.reviewed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROPOSAL_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nova.assign_task_billing_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  policy_class nova.task_billing_class;
  policy_revision integer;
  workstream_archived_at timestamptz;
BEGIN
  IF NEW.client_workstream_id IS NOT NULL THEN
    SELECT billing_policy_class, billing_policy_revision, archived_at
      INTO policy_class, policy_revision, workstream_archived_at
    FROM nova.client_workstreams
    WHERE id = NEW.client_workstream_id
      AND organisation_id = NEW.organisation_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'TASK_BILLING_POLICY_WORKSTREAM_NOT_FOUND';
    END IF;
    IF workstream_archived_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_POLICY_WORKSTREAM_ARCHIVED';
    END IF;
    IF policy_class IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_POLICY_NOT_CONFIGURED';
    END IF;
    NEW.billing_class := policy_class;
    NEW.billing_policy_source := 'client_workstream';
    NEW.billing_policy_revision := policy_revision;
  ELSE
    SELECT archived_at INTO workstream_archived_at
    FROM nova.organisation_workstreams
    WHERE id = NEW.organisation_workstream_id
      AND organisation_id = NEW.organisation_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'TASK_BILLING_POLICY_WORKSTREAM_NOT_FOUND';
    END IF;
    IF workstream_archived_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_POLICY_WORKSTREAM_ARCHIVED';
    END IF;
    NEW.billing_class := 'non_billable';
    NEW.billing_policy_source := 'organisation_default';
    NEW.billing_policy_revision := 1;
  END IF;

  IF NEW.task_catalog_revision IS NOT NULL AND NEW.task_catalog_entry_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROVENANCE_INVALID';
  END IF;
  IF NEW.task_catalog_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM nova.task_catalog_entries entries
    WHERE entries.id = NEW.task_catalog_entry_id
      AND entries.organisation_id = NEW.organisation_id
      AND entries.archived_at IS NULL
      AND entries.revision = NEW.task_catalog_revision
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_ENTRY_OR_REVISION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nova.prevent_task_billing_provenance_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF ROW(NEW.billing_class, NEW.billing_policy_source, NEW.billing_policy_revision,
         NEW.correction_of_task_id, NEW.correction_reason,
         NEW.task_catalog_entry_id, NEW.task_catalog_revision)
      IS DISTINCT FROM
     ROW(OLD.billing_class, OLD.billing_policy_source, OLD.billing_policy_revision,
         OLD.correction_of_task_id, OLD.correction_reason,
         OLD.task_catalog_entry_id, OLD.task_catalog_revision) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_PROVENANCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER tasks_billing_provenance_immutable ON nova.tasks;
CREATE TRIGGER tasks_billing_provenance_immutable
BEFORE UPDATE OF billing_class, billing_policy_source, billing_policy_revision,
  correction_of_task_id, correction_reason, task_catalog_entry_id,
  task_catalog_revision ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.prevent_task_billing_provenance_change();

UPDATE nova.permissions
SET description = 'Create tasks NOVA classifies as billable under the authorized work-context policy. This is an action permission, not a class selector.',
    allowed_scopes = ARRAY['organisation','client','client_workstream','group']::nova.permission_scope[]
WHERE key = 'tasks.create.billable';

INSERT INTO nova.permissions (key, module, description, allowed_scopes) VALUES
  ('workstreams.billing_policy.manage', 'work_context', 'Set the automatic billing policy for client workstreams; does not classify individual tasks or reusable definitions.', ARRAY['organisation','client','client_workstream']::nova.permission_scope[])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  description = EXCLUDED.description,
  allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, 'workstreams.billing_policy.manage', 'organisation'::nova.permission_scope
FROM nova.roles roles
WHERE roles.key = 'super_admin'
ON CONFLICT DO NOTHING;
