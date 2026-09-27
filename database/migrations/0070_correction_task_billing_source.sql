-- Correction links describe why work exists; the task's own approved
-- definition (or the one-off default) determines its billing class.
CREATE OR REPLACE FUNCTION nova.assign_task_billing_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  definition_billing_class nova.task_billing_class;
  definition_revision integer;
  definition_archived_at timestamptz;
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

    NEW.billing_class := definition_billing_class;
  ELSE
    IF NEW.task_catalog_revision IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CATALOG_PROVENANCE_INVALID';
    END IF;
    NEW.billing_class := 'non_billable';
  END IF;

  RETURN NEW;
END;
$$;

UPDATE nova.permissions
SET description = 'Create tasks NOVA classifies as billable from an approved definition. Also grant tasks.catalog.view so the role can select definitions, unless it manages the catalog. Does not permit choosing or editing the class.'
WHERE key = 'tasks.create.billable';
