-- Proves the Better Auth shared rate-limit table is portable and isolated.
-- Always rollback.

BEGIN;

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

DO $$
DECLARE
  stored_count integer;
BEGIN
  INSERT INTO nova_auth."rateLimit" (id, key, count, "lastRequest")
  VALUES ('rate-limit-test-1', 'test:shared-key', 1, 1000);

  UPDATE nova_auth."rateLimit"
  SET count = count + 1, "lastRequest" = 2000
  WHERE key = 'test:shared-key' AND count = 1;

  SELECT count INTO stored_count
  FROM nova_auth."rateLimit"
  WHERE key = 'test:shared-key';

  IF stored_count <> 2 THEN
    RAISE EXCEPTION 'Better Auth rate-limit row did not update atomically';
  END IF;

  BEGIN
    INSERT INTO nova_auth."rateLimit" (id, key, count, "lastRequest")
    VALUES ('rate-limit-test-2', 'test:shared-key', 1, 3000);
    RAISE EXCEPTION 'Better Auth rate-limit key uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
