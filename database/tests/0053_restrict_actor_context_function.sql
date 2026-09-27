BEGIN;

DO $$
BEGIN
  IF has_function_privilege('public', 'nova.request_has_valid_actor()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACTOR_CONTEXT_FUNCTION_PUBLIC_EXECUTE';
  END IF;
END;
$$;

ROLLBACK;
