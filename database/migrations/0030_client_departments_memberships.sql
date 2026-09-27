-- Phase 3 additive slice: client departments and effective-dated client
-- membership. Organisation departments remain the person's primary membership.

CREATE TABLE nova.client_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  client_id uuid NOT NULL REFERENCES nova.clients(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (client_id, name)
);

CREATE TABLE nova.client_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  client_id uuid NOT NULL REFERENCES nova.clients(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  client_department_id uuid REFERENCES nova.client_departments(id),
  membership_label text CHECK (membership_label IS NULL OR btrim(membership_label) <> ''),
  effective_on date NOT NULL DEFAULT current_date,
  effective_until date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  UNIQUE (client_id, person_id, effective_on)
);

CREATE INDEX client_memberships_person_active
  ON nova.client_memberships (person_id, client_id, effective_on);

CREATE FUNCTION nova.validate_client_access_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  client_organisation_id uuid;
  person_organisation_id uuid;
  department_client_id uuid;
BEGIN
  SELECT organisation_id INTO client_organisation_id FROM nova.clients WHERE id = NEW.client_id;
  SELECT organisation_id INTO person_organisation_id FROM nova.people WHERE id = NEW.person_id;
  IF client_organisation_id IS DISTINCT FROM NEW.organisation_id
    OR (TG_TABLE_NAME = 'client_memberships' AND person_organisation_id IS DISTINCT FROM NEW.organisation_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CLIENT_ACCESS_ORGANISATION_MISMATCH';
  END IF;
  IF TG_TABLE_NAME = 'client_memberships' AND NEW.client_department_id IS NOT NULL THEN
    SELECT client_id INTO department_client_id FROM nova.client_departments WHERE id = NEW.client_department_id;
    IF department_client_id IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CLIENT_DEPARTMENT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_departments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.client_departments
FOR EACH ROW EXECUTE FUNCTION nova.validate_client_access_organisation();
CREATE TRIGGER client_memberships_validate_organisation
BEFORE INSERT OR UPDATE ON nova.client_memberships
FOR EACH ROW EXECUTE FUNCTION nova.validate_client_access_organisation();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('clients.departments.manage', 'work_context', 'Manage departments within a client.'),
  ('clients.members.manage', 'work_context', 'Manage people membership within a client.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('clients.departments.manage', 'clients.members.manage')
ON CONFLICT DO NOTHING;

ALTER TABLE nova.client_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.client_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_departments_request_organisation ON nova.client_departments
FOR ALL USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
CREATE POLICY client_memberships_request_organisation ON nova.client_memberships
FOR ALL USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
