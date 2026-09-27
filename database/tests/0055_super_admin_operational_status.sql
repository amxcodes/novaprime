BEGIN;

DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('nova.request_actor_is_super_admin()'::regprocedure)
  INTO definition;
  IF definition NOT LIKE '%statuses.status IN%'
    OR definition NOT LIKE '%person_business_date%' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_CHECK_NOT_OPERATIONAL_OR_BUSINESS_DATE_AWARE';
  END IF;
END;
$$;

ROLLBACK;
