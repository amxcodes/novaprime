-- A single maintenance invocation owns the global lease at a time. The
-- fixture is transactional and exercises the runtime role's function-only
-- access, expiry recovery, renewal, and stale-owner fencing.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'nova.background_tick_lease'::regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'maintenance lease storage does not have row-level security enabled';
  END IF;
  IF NOT has_function_privilege('nova_app', 'nova.try_acquire_background_tick_lease(uuid,integer)', 'EXECUTE') OR
     NOT has_function_privilege('nova_app', 'nova.renew_background_tick_lease(uuid,integer)', 'EXECUTE') OR
     NOT has_function_privilege('nova_app', 'nova.release_background_tick_lease(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime role cannot execute maintenance lease functions';
  END IF;
  IF has_table_privilege('nova_app', 'nova.background_tick_lease', 'SELECT') OR
     has_table_privilege('nova_app', 'nova.background_tick_lease', 'INSERT') OR
     has_table_privilege('nova_app', 'nova.background_tick_lease', 'UPDATE') OR
     has_table_privilege('nova_app', 'nova.background_tick_lease', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role can inspect or mutate maintenance lease storage directly';
  END IF;
END;
$$;

SET LOCAL ROLE nova_app;
DO $$
DECLARE
  owner_a constant uuid := '00000000-0000-4000-8000-000000000001';
  owner_b constant uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  BEGIN
    PERFORM 1 FROM nova.background_tick_lease;
    RAISE EXCEPTION 'non-owner runtime role read maintenance lease storage directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF NOT nova.try_acquire_background_tick_lease(owner_a, 180) THEN
    RAISE EXCEPTION 'first maintenance invocation could not acquire the lease';
  END IF;
  IF nova.try_acquire_background_tick_lease(owner_b, 180) THEN
    RAISE EXCEPTION 'overlapping maintenance invocation acquired an active lease';
  END IF;
  IF NOT nova.renew_background_tick_lease(owner_a, 180) THEN
    RAISE EXCEPTION 'current maintenance owner could not renew its lease';
  END IF;
  IF nova.release_background_tick_lease(owner_b) THEN
    RAISE EXCEPTION 'non-owner released the active maintenance lease';
  END IF;
  IF nova.try_acquire_background_tick_lease(owner_b, 180) THEN
    RAISE EXCEPTION 'wrong-owner release made the active lease available';
  END IF;
  IF NOT nova.release_background_tick_lease(owner_a) THEN
    RAISE EXCEPTION 'current maintenance owner could not release its lease';
  END IF;
  IF NOT nova.try_acquire_background_tick_lease(owner_b, 180) THEN
    RAISE EXCEPTION 'released maintenance lease was not available';
  END IF;
  IF nova.renew_background_tick_lease(owner_a, 180) OR
     nova.release_background_tick_lease(owner_a) THEN
    RAISE EXCEPTION 'stale maintenance owner retained lease control';
  END IF;

  BEGIN
    PERFORM nova.try_acquire_background_tick_lease(owner_a, 59);
    RAISE EXCEPTION 'invalid lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END;
$$;

RESET ROLE;
UPDATE nova.background_tick_lease
SET lease_until = clock_timestamp() - interval '1 second'
WHERE singleton;

DO $$
DECLARE
  owner_a constant uuid := '00000000-0000-4000-8000-000000000001';
  owner_b constant uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  IF NOT nova.try_acquire_background_tick_lease(owner_a, 180) THEN
    RAISE EXCEPTION 'expired maintenance lease could not be recovered';
  END IF;
  IF nova.renew_background_tick_lease(owner_b, 180) OR
     nova.release_background_tick_lease(owner_b) THEN
    RAISE EXCEPTION 'previous lease owner controlled a lease after takeover';
  END IF;
  IF NOT nova.renew_background_tick_lease(owner_a, 180) OR
     NOT nova.release_background_tick_lease(owner_a) THEN
    RAISE EXCEPTION 'new maintenance owner lost lease control after takeover';
  END IF;
END;
$$;

ROLLBACK;
