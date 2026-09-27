-- Keep deployment-level Super Admin checks on the same office-local business
-- date used by the normal permission engine. This prevents a UTC midnight
-- boundary from disagreeing with role visibility in the rest of NOVA.
CREATE OR REPLACE FUNCTION nova.request_actor_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    WHERE assignments.person_id = nova.request_user_id()
      AND assignments.effective_on <= nova.person_business_date(assignments.person_id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))
      AND roles.key = 'super_admin'
      AND roles.is_protected
      AND roles.archived_at IS NULL
  );
$$;
