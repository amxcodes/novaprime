-- Repair installations that applied 0016 before its legacy CHECK cleanup was
-- corrected. The canonical 0016 constraint remains the single source of truth.
ALTER TABLE nova.role_permission_grants
  DROP CONSTRAINT IF EXISTS role_permission_grants_check;
