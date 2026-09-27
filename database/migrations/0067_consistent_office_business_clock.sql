-- Effective-date and office-local-day decisions in one statement must share
-- the same instant. clock_timestamp() can cross midnight between predicates,
-- despite this function being declared STABLE.
CREATE OR REPLACE FUNCTION nova.person_business_date(p_person_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT (statement_timestamp() AT TIME ZONE offices.timezone)::date
    FROM nova.person_office_assignments assignments
    JOIN nova.offices offices ON offices.id = assignments.office_id
    WHERE assignments.person_id = p_person_id
      AND offices.archived_at IS NULL
      AND assignments.effective_on <= (statement_timestamp() AT TIME ZONE offices.timezone)::date
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= (statement_timestamp() AT TIME ZONE offices.timezone)::date)
    ORDER BY assignments.effective_on DESC
    LIMIT 1
  ), (statement_timestamp() AT TIME ZONE 'UTC')::date);
$$;
