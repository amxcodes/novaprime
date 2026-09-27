DO $$
DECLARE
  v_data_type text;
  v_default text;
  v_nullable text;
  v_constraint boolean;
BEGIN
  SELECT data_type, column_default, is_nullable
  INTO v_data_type, v_default, v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'nova'
    AND table_name = 'roles'
    AND column_name = 'revision';

  IF v_data_type IS DISTINCT FROM 'integer'
    OR v_default IS DISTINCT FROM '1'
    OR v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'ROLE_REVISION_DEFAULT_INVALID';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nova.roles'::regclass
      AND conname = 'roles_revision_check'
  ) INTO v_constraint;

  IF NOT v_constraint THEN
    RAISE EXCEPTION 'ROLE_REVISION_POSITIVE_CHECK_MISSING';
  END IF;
END;
$$;
