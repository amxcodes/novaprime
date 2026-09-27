-- Correct the nullable CHECK semantics from 0037. PostgreSQL CHECK
-- constraints treat NULL as unknown/pass, so the complete branch must make
-- the reason explicitly non-null.

ALTER TABLE nova.task_assignments
  DROP CONSTRAINT task_assignments_reviewer_exception_complete;

ALTER TABLE nova.task_assignments
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
