-- A cancelled assignee may later accept the same task again through a new,
-- explicit handover. Keep the full assignment history while preventing two
-- non-cancelled records for the same person and task.

ALTER TABLE nova.task_assignments
  DROP CONSTRAINT task_assignments_task_id_person_id_key;

CREATE UNIQUE INDEX task_assignments_active_task_person
  ON nova.task_assignments (task_id, person_id)
  WHERE status <> 'cancelled';
