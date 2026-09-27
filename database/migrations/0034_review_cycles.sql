-- Phase 5 first vertical slice: immutable review-cycle history.

CREATE TABLE nova.task_review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  assignment_id uuid NOT NULL REFERENCES nova.task_assignments(id),
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  reviewer_person_id uuid NOT NULL REFERENCES nova.people(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  decision text CHECK (decision IS NULL OR decision IN ('approved', 'changes_requested')),
  feedback text,
  UNIQUE (assignment_id, cycle_number),
  CHECK ((decision IS NULL AND decided_at IS NULL) OR (decision IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE UNIQUE INDEX task_review_cycles_open
  ON nova.task_review_cycles (assignment_id) WHERE decided_at IS NULL;

CREATE FUNCTION nova.reject_decided_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.decided_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DECIDED_REVIEW_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_review_cycles_reject_decided_mutation
BEFORE UPDATE OR DELETE ON nova.task_review_cycles
FOR EACH ROW EXECUTE FUNCTION nova.reject_decided_review_mutation();

ALTER TABLE nova.task_review_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_review_cycles_request_organisation ON nova.task_review_cycles
FOR ALL USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
