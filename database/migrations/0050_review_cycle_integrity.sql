-- A null reviewer is a deliberate blocked-review state, not a general review
-- cycle value. Keep the invariant true for direct application-role writes too.

CREATE FUNCTION nova.validate_review_cycle_reviewer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  assignment_status nova.assignment_status;
  blocked_reason text;
BEGIN
  IF NEW.reviewer_person_id IS NULL THEN
    SELECT assignments.status, assignments.review_blocked_reason
      INTO assignment_status, blocked_reason
    FROM nova.task_assignments assignments
    WHERE assignments.id = NEW.assignment_id;

    IF assignment_status IS DISTINCT FROM 'awaiting_review'::nova.assignment_status
       OR blocked_reason IS DISTINCT FROM 'NO_ELIGIBLE_REVIEWER' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVIEW_CYCLE_REVIEWER_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_review_cycles_validate_reviewer
BEFORE INSERT OR UPDATE OF reviewer_person_id ON nova.task_review_cycles
FOR EACH ROW EXECUTE FUNCTION nova.validate_review_cycle_reviewer();
