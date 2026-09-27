-- Provider-neutral, office-local business date for effective-dated commands.
-- This keeps people in different office timezones on their own operational day.

CREATE FUNCTION nova.person_business_date(p_person_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT (clock_timestamp() AT TIME ZONE offices.timezone)::date
    FROM nova.person_office_assignments assignments
    JOIN nova.offices offices ON offices.id = assignments.office_id
    WHERE assignments.person_id = p_person_id
      AND offices.archived_at IS NULL
      AND assignments.effective_on <= (clock_timestamp() AT TIME ZONE offices.timezone)::date
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= (clock_timestamp() AT TIME ZONE offices.timezone)::date)
    ORDER BY assignments.effective_on DESC
    LIMIT 1
  ), (clock_timestamp() AT TIME ZONE 'UTC')::date);
$$;

REVOKE ALL ON FUNCTION nova.person_business_date(uuid) FROM PUBLIC;
