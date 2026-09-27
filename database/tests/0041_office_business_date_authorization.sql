-- Proves the protected-role resolver uses the portable business-date function.
-- Always rollback.

BEGIN;
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('nova.request_actor_is_super_admin()'::regprocedure)
    INTO definition;
  IF position('person_business_date' IN definition) = 0 THEN
    RAISE EXCEPTION 'protected-role resolver still depends on server current_date';
  END IF;
END;
$$;
ROLLBACK;
