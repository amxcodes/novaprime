-- Explicit, auditable reviewer exceptions. A protected Super Admin grants the
-- exception through the API; PostgreSQL preserves the actor/reason together
-- with the selected reviewer and prevents partial or cross-organisation data.

ALTER TABLE nova.task_assignments
  ADD COLUMN reviewer_exception_reason text,
  ADD COLUMN reviewer_exception_granted_by_person_id uuid REFERENCES nova.people(id),
  ADD COLUMN reviewer_exception_granted_at timestamptz,
  ADD CONSTRAINT task_assignments_reviewer_exception_complete CHECK (
    (reviewer_exception_reason IS NULL
      AND reviewer_exception_granted_by_person_id IS NULL
      AND reviewer_exception_granted_at IS NULL)
    OR (reviewer_exception_reason IS NOT NULL
      AND btrim(reviewer_exception_reason) <> ''
      AND length(reviewer_exception_reason) <= 2000
      AND reviewer_exception_granted_by_person_id IS NOT NULL
      AND reviewer_exception_granted_at IS NOT NULL)
  );

CREATE FUNCTION nova.validate_reviewer_exception_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reviewer_exception_granted_by_person_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM nova.people people
      WHERE people.id = NEW.reviewer_exception_granted_by_person_id
        AND people.organisation_id = NEW.organisation_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVIEWER_EXCEPTION_ACTOR_ORGANISATION_MISMATCH';
  END IF;
  IF NEW.reviewer_exception_granted_by_person_id IS NOT NULL
    AND NEW.reviewer_person_id = NEW.person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVIEWER_EXCEPTION_SELF_REVIEW_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_assignments_validate_reviewer_exception
BEFORE INSERT OR UPDATE ON nova.task_assignments
FOR EACH ROW EXECUTE FUNCTION nova.validate_reviewer_exception_organisation();
