-- Keep automatic workstream defaults for one-off work, but allow a separately
-- authorized policy manager to override each reusable definition per client
-- workstream. Task creators and catalog editors still cannot choose a class.

ALTER TABLE nova.tasks
  DROP CONSTRAINT tasks_billing_policy_source_check,
  ADD CONSTRAINT tasks_billing_policy_source_check CHECK (
    billing_policy_source IN (
      'client_workstream', 'client_workstream_task_definition',
      'organisation_default', 'legacy_snapshot'
    )
  );

CREATE TABLE nova.client_workstream_task_billing_rules (
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  client_workstream_id uuid NOT NULL REFERENCES nova.client_workstreams(id),
  task_catalog_entry_id uuid NOT NULL,
  billing_class nova.task_billing_class,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  set_by_person_id uuid REFERENCES nova.people(id),
  set_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_workstream_id, task_catalog_entry_id),
  FOREIGN KEY (organisation_id, task_catalog_entry_id)
    REFERENCES nova.task_catalog_entries (organisation_id, id),
  CHECK ((set_by_person_id IS NULL) = (set_at IS NULL))
);

-- Migration 0073 preserved the previous active overrides in the audit log.
-- Restore their latest rule state for existing installations, including an
-- explicit reset-to-default revision; migration audit remains the full history.
WITH retired AS (
  SELECT DISTINCT ON (events.organisation_id, events.target_id, entries.id)
         events.organisation_id,
         events.target_id AS client_workstream_id,
         entries.id AS task_catalog_entry_id,
         CASE WHEN events.details->>'previousClass' IN ('billable', 'non_billable')
           THEN (events.details->>'previousClass')::nova.task_billing_class END AS billing_class,
         CASE WHEN events.details->>'previousRevision' ~ '^[1-9][0-9]{0,8}$'
           THEN (events.details->>'previousRevision')::integer ELSE 1 END AS revision,
         CASE WHEN people.id IS NOT NULL AND NULLIF(events.details->>'previouslySetAt', '') IS NOT NULL
           THEN people.id END AS set_by_person_id,
         CASE WHEN people.id IS NOT NULL AND NULLIF(events.details->>'previouslySetAt', '') IS NOT NULL
           THEN NULLIF(events.details->>'previouslySetAt', '')::timestamptz END AS set_at,
         COALESCE(NULLIF(events.details->>'recordUpdatedAt', '')::timestamptz, events.occurred_at) AS updated_at
  FROM nova.audit_events events
  JOIN nova.client_workstreams workstreams
    ON workstreams.id = events.target_id
   AND workstreams.organisation_id = events.organisation_id
   AND workstreams.archived_at IS NULL
  JOIN nova.task_catalog_entries entries
    ON entries.id::text = events.details->>'taskCatalogEntryId'
   AND entries.organisation_id = events.organisation_id
   AND entries.archived_at IS NULL
  LEFT JOIN nova.people people
    ON people.id::text = events.details->>'previouslySetByPersonId'
   AND people.organisation_id = events.organisation_id
  WHERE events.action = 'billing_policy.definition_rule_retired'
    AND events.target_type = 'client_workstream'
    AND (
      (events.details->>'previousState' = 'definition_override'
       AND events.details->>'previousClass' IN ('billable', 'non_billable'))
      OR (events.details->>'previousState' = 'inherit_workstream_policy'
          AND events.details->>'previousClass' IS NULL)
    )
    AND events.details->>'taskCatalogEntryId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ORDER BY events.organisation_id, events.target_id, entries.id, events.occurred_at DESC, events.id DESC
)
INSERT INTO nova.client_workstream_task_billing_rules (
  organisation_id, client_workstream_id, task_catalog_entry_id,
  billing_class, revision, set_by_person_id, set_at, updated_at
)
SELECT organisation_id, client_workstream_id, task_catalog_entry_id,
       billing_class, revision, set_by_person_id, set_at, updated_at
FROM retired;

CREATE FUNCTION nova.guard_client_workstream_task_billing_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.set_by_person_id IS NOT NULL OR NEW.set_at IS NOT NULL
       OR NOT nova.request_has_valid_actor()
       OR NEW.organisation_id IS DISTINCT FROM nova.request_organisation_id()
       OR NOT EXISTS (
         SELECT 1 FROM nova.people people
         WHERE people.id = nova.request_user_id()
           AND people.organisation_id = NEW.organisation_id
       )
       OR NEW.billing_class IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM nova.client_workstreams workstreams
         WHERE workstreams.id = NEW.client_workstream_id
           AND workstreams.organisation_id = NEW.organisation_id
           AND workstreams.archived_at IS NULL
           AND workstreams.billing_policy_class IS NOT NULL
       )
       OR NOT EXISTS (
         SELECT 1 FROM nova.task_catalog_entries entries
         WHERE entries.id = NEW.task_catalog_entry_id
           AND entries.organisation_id = NEW.organisation_id
           AND entries.archived_at IS NULL
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_RULE_ACTOR_OR_SCOPE_INVALID';
    END IF;
    NEW.set_by_person_id := nova.request_user_id();
    NEW.set_at := statement_timestamp();
    NEW.created_at := statement_timestamp();
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF ROW(NEW.organisation_id, NEW.client_workstream_id, NEW.task_catalog_entry_id,
         NEW.revision, NEW.set_by_person_id, NEW.set_at, NEW.created_at, NEW.updated_at)
      IS DISTINCT FROM
     ROW(OLD.organisation_id, OLD.client_workstream_id, OLD.task_catalog_entry_id,
         OLD.revision, OLD.set_by_person_id, OLD.set_at, OLD.created_at, OLD.updated_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_RULE_PROVENANCE_SERVER_ASSIGNED';
  END IF;

  IF NEW.billing_class IS DISTINCT FROM OLD.billing_class THEN
    IF NOT nova.request_has_valid_actor()
       OR NEW.organisation_id IS DISTINCT FROM nova.request_organisation_id()
       OR NOT EXISTS (
         SELECT 1 FROM nova.people people
         WHERE people.id = nova.request_user_id()
           AND people.organisation_id = NEW.organisation_id
       )
       OR NOT EXISTS (
         SELECT 1 FROM nova.client_workstreams workstreams
         WHERE workstreams.id = NEW.client_workstream_id
           AND workstreams.organisation_id = NEW.organisation_id
           AND workstreams.archived_at IS NULL
           AND workstreams.billing_policy_class IS NOT NULL
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_BILLING_RULE_ACTOR_OR_SCOPE_INVALID';
    END IF;
    NEW.revision := OLD.revision + 1;
    NEW.set_by_person_id := nova.request_user_id();
    NEW.set_at := statement_timestamp();
    NEW.updated_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_workstream_task_billing_rule_guard
BEFORE INSERT OR UPDATE ON nova.client_workstream_task_billing_rules
FOR EACH ROW EXECUTE FUNCTION nova.guard_client_workstream_task_billing_rule();

ALTER TABLE nova.client_workstream_task_billing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_workstream_task_billing_rules_request_organisation
ON nova.client_workstream_task_billing_rules FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
GRANT SELECT, INSERT, UPDATE ON nova.client_workstream_task_billing_rules TO nova_app;

CREATE OR REPLACE FUNCTION nova.assign_task_billing_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  policy_class nova.task_billing_class;
  policy_revision integer;
  policy_source text;
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

    policy_source := 'client_workstream';
    IF NEW.task_catalog_entry_id IS NOT NULL THEN
      SELECT rules.billing_class, rules.revision
        INTO policy_class, policy_revision
      FROM nova.client_workstream_task_billing_rules rules
      WHERE rules.organisation_id = NEW.organisation_id
        AND rules.client_workstream_id = NEW.client_workstream_id
        AND rules.task_catalog_entry_id = NEW.task_catalog_entry_id
      FOR SHARE;
      IF FOUND AND policy_class IS NOT NULL THEN
        policy_source := 'client_workstream_task_definition';
      ELSE
        SELECT billing_policy_class, billing_policy_revision
          INTO policy_class, policy_revision
        FROM nova.client_workstreams
        WHERE id = NEW.client_workstream_id
          AND organisation_id = NEW.organisation_id;
      END IF;
    END IF;

    NEW.billing_class := policy_class;
    NEW.billing_policy_source := policy_source;
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

UPDATE nova.permissions
SET description = 'Set the automatic client-workstream default and authorized per-definition overrides. Task creators never choose the class.',
    allowed_scopes = ARRAY['organisation','client','client_workstream']::nova.permission_scope[]
WHERE key = 'workstreams.billing_policy.manage';

UPDATE nova.permissions
SET description = 'Create tasks NOVA automatically classifies as billable under the applicable workstream or predefined-task policy. This is an action permission, not a class selector.'
WHERE key = 'tasks.create.billable';
