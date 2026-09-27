-- NOVA Phase 2: effective-dated WFH eligibility overrides.
-- WFH remains an attendance mode; this table only resolves eligibility.

CREATE TYPE nova.wfh_policy_target AS ENUM (
  'office',
  'organisation_department',
  'person'
);

CREATE TABLE nova.wfh_policy_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  target_type nova.wfh_policy_target NOT NULL,
  target_id uuid NOT NULL,
  allowed boolean NOT NULL,
  effective_on date NOT NULL,
  effective_until date,
  reason text CHECK (reason IS NULL OR length(reason) <= 2000),
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  EXCLUDE USING gist (
    organisation_id WITH =,
    target_type WITH =,
    target_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  )
);

CREATE INDEX wfh_policy_overrides_lookup
  ON nova.wfh_policy_overrides (organisation_id, target_type, target_id, effective_on);

CREATE FUNCTION nova.validate_wfh_policy_override_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_organisation_id uuid;
  creator_organisation_id uuid;
BEGIN
  IF NEW.target_type = 'office' THEN
    SELECT organisation_id INTO target_organisation_id FROM nova.offices WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'organisation_department' THEN
    SELECT organisation_id INTO target_organisation_id FROM nova.organisation_departments WHERE id = NEW.target_id;
  ELSE
    SELECT organisation_id INTO target_organisation_id FROM nova.people WHERE id = NEW.target_id;
  END IF;

  SELECT organisation_id INTO creator_organisation_id
  FROM nova.people WHERE id = NEW.created_by_person_id;

  IF target_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR creator_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WFH_POLICY_ORGANISATION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wfh_policy_overrides_validate_organisation
BEFORE INSERT OR UPDATE ON nova.wfh_policy_overrides
FOR EACH ROW EXECUTE FUNCTION nova.validate_wfh_policy_override_organisation();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('availability.wfh_policy.view', 'availability', 'View effective-dated WFH eligibility overrides.'),
  ('availability.wfh_policy.manage', 'availability', 'Create effective-dated WFH eligibility overrides.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('availability.wfh_policy.view', 'availability.wfh_policy.manage')
ON CONFLICT DO NOTHING;

ALTER TABLE nova.wfh_policy_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY wfh_policy_overrides_request_organisation ON nova.wfh_policy_overrides
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
