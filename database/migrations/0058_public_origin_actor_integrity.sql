-- Keep the audit actor on a runtime-settings row inside the same organisation
-- even when a privileged SQL caller bypasses the API command.
CREATE FUNCTION nova.validate_runtime_setting_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF NEW.updated_by_person_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM nova.people
      WHERE people.id = NEW.updated_by_person_id
        AND people.organisation_id = NEW.organisation_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RUNTIME_SETTING_ACTOR_ORGANISATION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION nova.validate_runtime_setting_actor() FROM PUBLIC;

CREATE TRIGGER organisation_runtime_settings_validate_actor
BEFORE INSERT OR UPDATE ON nova.organisation_runtime_settings
FOR EACH ROW EXECUTE FUNCTION nova.validate_runtime_setting_actor();
