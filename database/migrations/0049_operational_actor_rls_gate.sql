-- A request context is only a valid normal API actor while the person remains
-- operational. This closes the race where a request passed its pre-transaction
-- session check and then attempted a write after freeze/offboarding committed.

CREATE OR REPLACE FUNCTION nova.request_has_valid_actor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.people people
    JOIN nova.person_status_periods statuses
      ON statuses.person_id = people.id
     AND statuses.ended_at IS NULL
     AND statuses.status IN ('active', 'notice')
    WHERE people.id = nova.request_user_id()
      AND people.organisation_id = nova.request_organisation_id()
  );
$$;
