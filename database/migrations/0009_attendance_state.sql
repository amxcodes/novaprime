-- NOVA Phase 2: one authoritative attendance state per person/business date.
-- Leave and productive work remain separate sources of truth.

CREATE TYPE nova.attendance_mode AS ENUM ('office', 'wfh');

CREATE TABLE nova.attendance_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  office_id uuid NOT NULL REFERENCES nova.offices(id),
  business_date date NOT NULL,
  mode nova.attendance_mode NOT NULL,
  checked_in_at timestamptz NOT NULL,
  checked_out_at timestamptz,
  mode_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (checked_out_at IS NULL OR checked_out_at > checked_in_at),
  CHECK (mode_changed_at IS NULL OR mode_changed_at >= checked_in_at),
  UNIQUE (person_id, business_date)
);

CREATE FUNCTION nova.validate_attendance_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
  office_organisation_id uuid;
BEGIN
  SELECT organisation_id INTO person_organisation_id
  FROM nova.people WHERE id = NEW.person_id;
  SELECT organisation_id INTO office_organisation_id
  FROM nova.offices WHERE id = NEW.office_id;
  IF NEW.organisation_id IS DISTINCT FROM person_organisation_id
     OR NEW.organisation_id IS DISTINCT FROM office_organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ATTENDANCE_ORGANISATION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_days_validate_organisation
BEFORE INSERT OR UPDATE ON nova.attendance_days
FOR EACH ROW EXECUTE FUNCTION nova.validate_attendance_organisation();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('attendance.change_mode', 'availability', 'Change the actor attendance mode during an open attendance state.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key = 'attendance.change_mode'
ON CONFLICT DO NOTHING;

ALTER TABLE nova.attendance_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_days_request_organisation ON nova.attendance_days
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
