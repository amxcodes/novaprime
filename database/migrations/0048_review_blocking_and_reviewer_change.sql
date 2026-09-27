-- Keep the assignment review lifecycle explicit when no eligible reviewer is
-- available. An open cycle may temporarily have no reviewer; a later
-- exception/reviewer change fills that snapshot without mutating history.

ALTER TABLE nova.task_review_cycles
  ALTER COLUMN reviewer_person_id DROP NOT NULL;

ALTER TABLE nova.task_assignments
  ADD COLUMN review_blocked_reason text,
  ADD COLUMN review_blocked_at timestamptz,
  ADD CONSTRAINT task_assignments_review_blocked_complete CHECK (
    (review_blocked_reason IS NULL AND review_blocked_at IS NULL)
    OR (
      review_required
      AND reviewer_person_id IS NULL
      AND review_blocked_reason = 'NO_ELIGIBLE_REVIEWER'
      AND review_blocked_at IS NOT NULL
    )
  );

CREATE INDEX task_assignments_review_blocked
  ON nova.task_assignments (organisation_id, status)
  WHERE review_blocked_reason IS NOT NULL;
