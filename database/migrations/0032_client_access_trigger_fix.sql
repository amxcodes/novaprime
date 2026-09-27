-- Compatibility repair: client departments do not have a person_id column.
CREATE OR REPLACE FUNCTION nova.validate_client_access_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  client_organisation_id uuid;
  person_organisation_id uuid;
  department_client_id uuid;
BEGIN
  SELECT organisation_id INTO client_organisation_id FROM nova.clients WHERE id = NEW.client_id;
  IF client_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CLIENT_ACCESS_ORGANISATION_MISMATCH';
  END IF;
  IF TG_TABLE_NAME = 'client_memberships' THEN
    SELECT organisation_id INTO person_organisation_id FROM nova.people WHERE id = NEW.person_id;
    IF person_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CLIENT_ACCESS_ORGANISATION_MISMATCH';
    END IF;
    IF NEW.client_department_id IS NOT NULL THEN
      SELECT client_id INTO department_client_id FROM nova.client_departments WHERE id = NEW.client_department_id;
      IF department_client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CLIENT_DEPARTMENT_MISMATCH';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
