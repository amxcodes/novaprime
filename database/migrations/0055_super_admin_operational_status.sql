-- Deployment-level protected-role checks must remain operational at the
-- transaction boundary. This closes the small race where a request resolved
-- an active actor before a concurrent freeze/offboarding transition committed.
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
    JOIN nova.person_status_periods statuses
      ON statuses.person_id = assignments.person_id
     AND statuses.ended_at IS NULL
     AND statuses.status IN ('active', 'notice')
    WHERE assignments.person_id = nova.request_user_id()
      AND assignments.effective_on <= nova.person_business_date(assignments.person_id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))
      AND roles.key = 'super_admin'
      AND roles.is_protected
      AND roles.archived_at IS NULL
  );
$$;
