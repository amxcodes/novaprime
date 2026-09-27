-- Billing class is assigned from an approved reusable definition, defaults to
-- non-billable for one-off work, and is inherited from the source by corrections.
-- Preserve those decisions after task creation and enforce them below the API.

CREATE FUNCTION nova.assign_task_billing_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  definition_billing_class nova.task_billing_class;
  definition_revision integer;
  definition_archived_at timestamptz;
  source_billing_class nova.task_billing_class;
BEGIN
  IF NEW.task_catalog_entry_id IS NOT NULL THEN
    SELECT billing_class, revision, archived_at
    INTO definition_billing_class, definition_revision, definition_archived_at
    FROM nova.task_catalog_entries
    WHERE id = NEW.task_catalog_entry_id
      AND organisation_id = NEW.organisation_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'TASK_CATALOG_ENTRY_NOT_FOUND';
    END IF;
    IF definition_archived_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_ENTRY_ARCHIVED';
    END IF;
    IF NEW.task_catalog_revision IS DISTINCT FROM definition_revision THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_VERSION_CONFLICT';
    END IF;
    IF NEW.correction_of_task_id IS NULL THEN
      NEW.billing_class := definition_billing_class;
    END IF;
  ELSIF NEW.task_catalog_revision IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROVENANCE_INVALID';
  END IF;

  IF NEW.correction_of_task_id IS NOT NULL THEN
    SELECT billing_class INTO source_billing_class
    FROM nova.tasks
    WHERE id = NEW.correction_of_task_id
      AND organisation_id = NEW.organisation_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'TASK_CORRECTION_SOURCE_NOT_FOUND';
    END IF;
    NEW.billing_class := source_billing_class;
  ELSIF NEW.task_catalog_entry_id IS NULL THEN
    NEW.billing_class := 'non_billable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_assign_billing_class
BEFORE INSERT ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.assign_task_billing_class();

CREATE FUNCTION nova.prevent_task_billing_provenance_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF ROW(NEW.billing_class, NEW.correction_of_task_id, NEW.correction_reason,
         NEW.task_catalog_entry_id, NEW.task_catalog_revision)
      IS DISTINCT FROM
     ROW(OLD.billing_class, OLD.correction_of_task_id, OLD.correction_reason,
         OLD.task_catalog_entry_id, OLD.task_catalog_revision) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_PROVENANCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_billing_provenance_immutable
BEFORE UPDATE OF billing_class, correction_of_task_id, correction_reason,
  task_catalog_entry_id, task_catalog_revision ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.prevent_task_billing_provenance_change();

INSERT INTO nova.permissions (key, module, description, allowed_scopes) VALUES
  ('tasks.create.billable', 'work_context', 'Create tasks NOVA classifies as billable from an approved definition or correction source. Does not permit choosing or editing the class.', ARRAY['organisation']::nova.permission_scope[])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  description = EXCLUDED.description,
  allowed_scopes = EXCLUDED.allowed_scopes;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, 'tasks.create.billable', 'organisation'::nova.permission_scope
FROM nova.roles roles
WHERE roles.key = 'super_admin'
ON CONFLICT DO NOTHING;
