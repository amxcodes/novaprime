-- A database row lease serializes maintenance ticks across provider instances.
-- It intentionally uses no session state, so transaction poolers and Hyperdrive
-- can safely route each acquire/renew/release statement independently.
CREATE TABLE nova.background_tick_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_token uuid NOT NULL,
  lease_until timestamptz NOT NULL
);
ALTER TABLE nova.background_tick_lease ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE nova.background_tick_lease FROM PUBLIC;
REVOKE ALL ON TABLE nova.background_tick_lease FROM nova_app;

CREATE FUNCTION nova.try_acquire_background_tick_lease(p_owner_token uuid, p_lease_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  acquired boolean;
BEGIN
  IF p_owner_token IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BACKGROUND_TICK_LEASE_INPUT_INVALID';
  END IF;

  INSERT INTO nova.background_tick_lease (singleton, owner_token, lease_until)
  VALUES (true, p_owner_token, clock_timestamp() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (singleton) DO UPDATE
    SET owner_token = EXCLUDED.owner_token,
        lease_until = EXCLUDED.lease_until
    WHERE nova.background_tick_lease.lease_until <= clock_timestamp()
  RETURNING true INTO acquired;

  RETURN COALESCE(acquired, false);
END;
$$;

CREATE FUNCTION nova.renew_background_tick_lease(p_owner_token uuid, p_lease_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_owner_token IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BACKGROUND_TICK_LEASE_INPUT_INVALID';
  END IF;

  UPDATE nova.background_tick_lease
  SET lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE singleton AND owner_token = p_owner_token AND lease_until > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

CREATE FUNCTION nova.release_background_tick_lease(p_owner_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_owner_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BACKGROUND_TICK_LEASE_INPUT_INVALID';
  END IF;

  DELETE FROM nova.background_tick_lease
  WHERE singleton AND owner_token = p_owner_token;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION nova.try_acquire_background_tick_lease(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.renew_background_tick_lease(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.release_background_tick_lease(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nova.try_acquire_background_tick_lease(uuid, integer) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.renew_background_tick_lease(uuid, integer) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.release_background_tick_lease(uuid) TO nova_app;
