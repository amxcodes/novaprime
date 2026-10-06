CREATE TABLE nova.organisation_access_revisions (
  organisation_id uuid PRIMARY KEY REFERENCES nova.organisations(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO nova.organisation_access_revisions (organisation_id)
SELECT id FROM nova.organisations
ON CONFLICT (organisation_id) DO NOTHING;

CREATE FUNCTION nova.bump_organisation_access_revision(target_organisation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
BEGIN
  IF target_organisation_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO nova.organisation_access_revisions (organisation_id, revision, updated_at)
  VALUES (target_organisation_id, 1, clock_timestamp())
  ON CONFLICT (organisation_id) DO UPDATE
  SET revision = nova.organisation_access_revisions.revision + 1,
      updated_at = clock_timestamp();
END;
$$;

CREATE FUNCTION nova.bump_organisation_access_revision_for_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  old_organisation_id uuid;
  new_organisation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'organisations' THEN
    IF TG_OP <> 'INSERT' THEN old_organisation_id := OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN new_organisation_id := NEW.id; END IF;
  ELSIF TG_TABLE_NAME IN ('people', 'offices', 'organisation_departments') THEN
    IF TG_OP <> 'INSERT' THEN old_organisation_id := OLD.organisation_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_organisation_id := NEW.organisation_id; END IF;
  ELSIF TG_TABLE_NAME = 'roles' THEN
    IF TG_OP <> 'INSERT' THEN old_organisation_id := OLD.organisation_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_organisation_id := NEW.organisation_id; END IF;
  ELSIF TG_TABLE_NAME = 'role_permission_grants' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT roles.organisation_id INTO old_organisation_id
      FROM nova.roles roles WHERE roles.id = OLD.role_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT roles.organisation_id INTO new_organisation_id
      FROM nova.roles roles WHERE roles.id = NEW.role_id;
    END IF;
  ELSIF TG_TABLE_NAME IN ('person_role_assignments', 'person_office_assignments', 'person_department_assignments') THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT people.organisation_id INTO old_organisation_id
      FROM nova.people people WHERE people.id = OLD.person_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT people.organisation_id INTO new_organisation_id
      FROM nova.people people WHERE people.id = NEW.person_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_ACCESS_REVISION_TABLE: %', TG_TABLE_NAME;
  END IF;

  PERFORM nova.bump_organisation_access_revision(old_organisation_id);
  IF new_organisation_id IS DISTINCT FROM old_organisation_id THEN
    PERFORM nova.bump_organisation_access_revision(new_organisation_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- These SECURITY DEFINER helpers are internal trigger plumbing, never API functions.
REVOKE EXECUTE ON FUNCTION nova.bump_organisation_access_revision(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION nova.bump_organisation_access_revision_for_row() FROM PUBLIC;

CREATE TRIGGER organisations_access_revision_insert
AFTER INSERT ON nova.organisations
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER people_access_revision_move
AFTER UPDATE OF organisation_id ON nova.people
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER offices_access_revision_move
AFTER UPDATE OF organisation_id ON nova.offices
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER departments_access_revision_move
AFTER UPDATE OF organisation_id ON nova.organisation_departments
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER roles_access_revision_change
AFTER INSERT OR UPDATE OR DELETE ON nova.roles
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER role_permission_grants_access_revision_change
AFTER INSERT OR UPDATE OR DELETE ON nova.role_permission_grants
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER person_role_assignments_access_revision_change
AFTER INSERT OR UPDATE OR DELETE ON nova.person_role_assignments
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER person_office_assignments_access_revision_change
AFTER INSERT OR UPDATE OR DELETE ON nova.person_office_assignments
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

CREATE TRIGGER person_department_assignments_access_revision_change
AFTER INSERT OR UPDATE OR DELETE ON nova.person_department_assignments
FOR EACH ROW EXECUTE FUNCTION nova.bump_organisation_access_revision_for_row();

ALTER TABLE nova.organisation_access_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY organisation_access_revisions_request_organisation
ON nova.organisation_access_revisions
FOR SELECT
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

GRANT SELECT ON nova.organisation_access_revisions TO nova_app;
