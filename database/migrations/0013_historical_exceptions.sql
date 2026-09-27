-- NOVA Phase 2: explicit historical exceptions for availability changes.
-- Exceptions preserve the original operational record and require a human
-- resolution; they are not a replacement source of truth.

CREATE TYPE nova.historical_exception_status AS ENUM (
  'open',
  'resolved',
  'dismissed'
);

CREATE TABLE nova.historical_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  source_type text NOT NULL CHECK (btrim(source_type) <> ''),
  source_id uuid NOT NULL,
  person_id uuid REFERENCES nova.people(id),
  business_date date,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.]{2,126}$'),
  status nova.historical_exception_status NOT NULL DEFAULT 'open',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_by_person_id uuid REFERENCES nova.people(id),
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  UNIQUE (organisation_id, source_type, source_id, code),
  CHECK ((status = 'open' AND resolved_by_person_id IS NULL AND resolved_at IS NULL)
    OR (status IN ('resolved', 'dismissed') AND resolved_by_person_id IS NOT NULL AND resolved_at IS NOT NULL))
);

CREATE INDEX historical_exceptions_open_lookup
  ON nova.historical_exceptions (organisation_id, status, business_date);

CREATE FUNCTION nova.validate_historical_exception_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
  resolver_organisation_id uuid;
BEGIN
  IF NEW.person_id IS NOT NULL THEN
    SELECT organisation_id INTO person_organisation_id FROM nova.people WHERE id = NEW.person_id;
    IF person_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HISTORICAL_EXCEPTION_PERSON_ORGANISATION_MISMATCH';
    END IF;
  END IF;
  IF NEW.resolved_by_person_id IS NOT NULL THEN
    SELECT organisation_id INTO resolver_organisation_id FROM nova.people WHERE id = NEW.resolved_by_person_id;
    IF resolver_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HISTORICAL_EXCEPTION_RESOLVER_ORGANISATION_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER historical_exceptions_validate_organisation
BEFORE INSERT OR UPDATE ON nova.historical_exceptions
FOR EACH ROW EXECUTE FUNCTION nova.validate_historical_exception_organisation();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('availability.exception.view', 'availability', 'View unresolved historical availability exceptions.'),
  ('availability.exception.resolve', 'availability', 'Resolve historical availability exceptions.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('availability.exception.view', 'availability.exception.resolve')
ON CONFLICT DO NOTHING;

ALTER TABLE nova.historical_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY historical_exceptions_request_organisation ON nova.historical_exceptions
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
