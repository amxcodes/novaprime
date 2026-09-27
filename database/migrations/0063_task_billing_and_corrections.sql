-- Task billability is ordinary task metadata. Correction work is represented
-- by a separate task linked to its completed original, never a billing event.

CREATE TYPE nova.task_billing_class AS ENUM ('billable', 'non_billable');

ALTER TABLE nova.tasks
  ADD COLUMN billing_class nova.task_billing_class NOT NULL DEFAULT 'non_billable',
  ADD COLUMN correction_of_task_id uuid,
  ADD COLUMN correction_reason text,
  ADD CONSTRAINT tasks_organisation_id_unique UNIQUE (organisation_id, id),
  ADD CONSTRAINT tasks_correction_source_same_organisation
    FOREIGN KEY (organisation_id, correction_of_task_id)
    REFERENCES nova.tasks (organisation_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT tasks_correction_not_self
    CHECK (correction_of_task_id IS NULL OR correction_of_task_id <> id),
  ADD CONSTRAINT tasks_correction_reason_consistent
    CHECK (
      (correction_of_task_id IS NULL AND correction_reason IS NULL)
      OR (correction_of_task_id IS NOT NULL
        AND correction_reason IS NOT NULL
        AND length(btrim(correction_reason)) BETWEEN 1 AND 2000)
    );

CREATE FUNCTION nova.validate_task_correction_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  original_client_workstream_id uuid;
  original_organisation_workstream_id uuid;
  original_status nova.task_status;
  original_correction_of_task_id uuid;
BEGIN
  IF NEW.correction_of_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT client_workstream_id, organisation_workstream_id, status, correction_of_task_id
  INTO original_client_workstream_id, original_organisation_workstream_id,
       original_status, original_correction_of_task_id
  FROM nova.tasks
  WHERE id = NEW.correction_of_task_id
    AND organisation_id = NEW.organisation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'TASK_CORRECTION_SOURCE_NOT_FOUND';
  END IF;
  IF original_status NOT IN ('approved', 'done') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CORRECTION_SOURCE_NOT_COMPLETE';
  END IF;
  IF original_correction_of_task_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CORRECTION_NESTING_NOT_ALLOWED';
  END IF;
  IF original_client_workstream_id IS DISTINCT FROM NEW.client_workstream_id
     OR original_organisation_workstream_id IS DISTINCT FROM NEW.organisation_workstream_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_CORRECTION_WORKSTREAM_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_validate_correction_source
BEFORE INSERT OR UPDATE OF organisation_id, client_workstream_id,
  organisation_workstream_id, correction_of_task_id, correction_reason
ON nova.tasks
FOR EACH ROW EXECUTE FUNCTION nova.validate_task_correction_source();

ALTER TABLE nova.work_sessions
  ADD COLUMN billing_class_snapshot nova.task_billing_class;

UPDATE nova.work_sessions sessions
SET billing_class_snapshot = tasks.billing_class
FROM nova.task_assignments assignments
JOIN nova.tasks tasks ON tasks.id = assignments.task_id
WHERE assignments.id = sessions.assignment_id;

ALTER TABLE nova.work_sessions
  ALTER COLUMN billing_class_snapshot SET DEFAULT 'non_billable',
  ALTER COLUMN billing_class_snapshot SET NOT NULL;

CREATE FUNCTION nova.snapshot_work_session_billing_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  task_billing_class nova.task_billing_class;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tasks.billing_class INTO task_billing_class
    FROM nova.task_assignments assignments
    JOIN nova.tasks tasks ON tasks.id = assignments.task_id
    WHERE assignments.id = NEW.assignment_id
      AND assignments.organisation_id = NEW.organisation_id
      AND assignments.person_id = NEW.person_id
    FOR SHARE OF tasks;
    IF task_billing_class IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_SESSION_TASK_BILLING_CLASS_MISSING';
    END IF;
    NEW.billing_class_snapshot := task_billing_class;
  ELSIF NEW.billing_class_snapshot IS DISTINCT FROM OLD.billing_class_snapshot THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WORK_SESSION_BILLING_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_sessions_snapshot_billing_class
BEFORE INSERT OR UPDATE OF billing_class_snapshot ON nova.work_sessions
FOR EACH ROW EXECUTE FUNCTION nova.snapshot_work_session_billing_class();
