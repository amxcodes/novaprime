-- Permission catalogue entries are not automatically available to customer
-- roles. New permissions remain disabled until their complete product feature
-- is implemented and deliberately enabled by a later migration.
ALTER TABLE nova.permissions
  ADD COLUMN customer_role_assignable boolean NOT NULL DEFAULT false;

-- Every permission available before this contract has a working role-backed
-- feature except payroll, whose catalogue entries are reserved for a future
-- payroll product and have no API or UI workflow today.
UPDATE nova.permissions
SET customer_role_assignable = true
WHERE key NOT LIKE 'payroll.%';

-- Keep existing grants intact. The API prevents new grants for these keys and
-- lets a role editor preserve any legacy grant without changing it.
