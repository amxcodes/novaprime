-- New tasks use one automatic class per workstream. Keep task snapshots and
-- audit the retired per-definition settings before removing their live rules.
INSERT INTO nova.audit_events (
  organisation_id, actor_person_id, action, target_type, target_id, details
)
SELECT rules.organisation_id, NULL, 'billing_policy.definition_rule_retired',
       'client_workstream', rules.client_workstream_id,
       jsonb_build_object(
         'migration', '0073_unified_workstream_billing_policy',
         'taskCatalogEntryId', rules.task_catalog_entry_id,
         'previousState', CASE WHEN rules.billing_class IS NULL
           THEN 'inherit_workstream_policy' ELSE 'definition_override' END,
         'previousClass', rules.billing_class,
         'previouslySetAt', rules.set_at,
         'recordUpdatedAt', rules.updated_at,
         'previousRevision', rules.revision,
         'previouslySetByPersonId', rules.set_by_person_id,
         'futureTasksClassifiedBy', 'client_workstream_policy',
         'futurePolicyClass', workstreams.billing_policy_class,
         'reason', 'Per-definition classification was retired; all future tasks use the workstream policy.'
       )
FROM nova.client_workstream_task_billing_rules rules
JOIN nova.client_workstreams workstreams
  ON workstreams.id = rules.client_workstream_id
 AND workstreams.organisation_id = rules.organisation_id;

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

DROP TABLE nova.client_workstream_task_billing_rules;
DROP FUNCTION nova.guard_client_workstream_task_billing_rule();

UPDATE nova.permissions
SET description = 'Set the automatic billing policy for a client workstream. It applies uniformly to free-form, predefined and correction tasks; it does not classify individual tasks or reusable definitions.'
WHERE key = 'workstreams.billing_policy.manage';

UPDATE nova.permissions
SET description = 'Create tasks NOVA automatically classifies as billable under the authorized workstream policy. This is an action permission, not a class selector.'
WHERE key = 'tasks.create.billable';
