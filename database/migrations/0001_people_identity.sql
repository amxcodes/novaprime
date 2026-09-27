-- NOVA Phase 1: People & Identity.
-- This migration owns only the first vertical slice. Work, attendance, review,
-- and payroll execution remain in their own later migrations.

CREATE SCHEMA IF NOT EXISTS nova;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA nova;

CREATE TYPE nova.person_status AS ENUM (
  'invited',
  'onboarding',
  'active',
  'notice',
  'offboarding',
  'frozen',
  'exited'
);

CREATE TYPE nova.permission_scope AS ENUM (
  'organisation',
  'own_record',
  'office',
  'organisation_department'
);

CREATE TABLE nova.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nova.offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  timezone text NOT NULL CHECK (btrim(timezone) <> ''),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.organisation_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  email text NOT NULL CHECK (email = lower(email) AND btrim(email) <> ''),
  display_name text CHECK (display_name IS NULL OR btrim(display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, email)
);

CREATE TABLE nova.person_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  subject text NOT NULL CHECK (btrim(subject) <> ''),
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (provider, subject)
);

CREATE TABLE nova.person_status_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  status nova.person_status NOT NULL,
  effective_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason text,
  CHECK (ended_at IS NULL OR ended_at > effective_at),
  EXCLUDE USING gist (
    person_id WITH =,
    tstzrange(effective_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') WITH &&
  )
);

CREATE UNIQUE INDEX person_one_current_status
  ON nova.person_status_periods (person_id)
  WHERE ended_at IS NULL;

CREATE TABLE nova.employment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  employment_starts_on date NOT NULL,
  employment_ends_on date,
  designation text CHECK (designation IS NULL OR btrim(designation) <> ''),
  manager_person_id uuid REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (employment_ends_on IS NULL OR employment_ends_on >= employment_starts_on),
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(
      employment_starts_on,
      COALESCE(employment_ends_on + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  )
);

CREATE TABLE nova.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  is_protected boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((key = 'super_admin') = is_protected),
  UNIQUE (organisation_id, key),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.role_operational_policies (
  role_id uuid PRIMARY KEY REFERENCES nova.roles(id) ON DELETE CASCADE,
  work_enabled boolean NOT NULL DEFAULT false,
  can_receive_assignments boolean NOT NULL DEFAULT false,
  attendance_required boolean NOT NULL DEFAULT false,
  wfh_allowed boolean NOT NULL DEFAULT false,
  can_work_without_attendance boolean NOT NULL DEFAULT false,
  payroll_applicable boolean NOT NULL DEFAULT false,
  payroll_attendance_contributes boolean NOT NULL DEFAULT false,
  payroll_overtime_applicable boolean NOT NULL DEFAULT false,
  CHECK (NOT can_receive_assignments OR work_enabled),
  CHECK (NOT attendance_required OR work_enabled),
  CHECK (NOT can_work_without_attendance OR work_enabled),
  CHECK (NOT payroll_attendance_contributes OR payroll_applicable),
  CHECK (NOT payroll_overtime_applicable OR payroll_applicable)
);

CREATE TABLE nova.permissions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{2,126}$'),
  module text NOT NULL CHECK (btrim(module) <> ''),
  description text NOT NULL CHECK (btrim(description) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nova.role_permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES nova.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES nova.permissions(key),
  scope nova.permission_scope NOT NULL,
  office_id uuid REFERENCES nova.offices(id),
  organisation_department_id uuid REFERENCES nova.organisation_departments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope IN ('organisation', 'own_record')
      AND office_id IS NULL
      AND organisation_department_id IS NULL)
    OR (scope = 'office'
      AND office_id IS NOT NULL
      AND organisation_department_id IS NULL)
    OR (scope = 'organisation_department'
      AND office_id IS NULL
      AND organisation_department_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX role_permission_grant_unique_scope
  ON nova.role_permission_grants (
    role_id,
    permission_key,
    scope,
    COALESCE(office_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(organisation_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE nova.person_office_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  office_id uuid NOT NULL REFERENCES nova.offices(id),
  effective_on date NOT NULL,
  effective_until date,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  )
);

CREATE TABLE nova.person_department_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  organisation_department_id uuid NOT NULL REFERENCES nova.organisation_departments(id),
  effective_on date NOT NULL,
  effective_until date,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  )
);

CREATE TABLE nova.person_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  role_id uuid NOT NULL REFERENCES nova.roles(id),
  effective_on date NOT NULL,
  effective_until date,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  )
);

CREATE TABLE nova.person_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  invitee_email text NOT NULL CHECK (invitee_email = lower(invitee_email) AND btrim(invitee_email) <> ''),
  token_hash bytea NOT NULL UNIQUE,
  invited_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > invited_at),
  CHECK (accepted_at IS NULL OR accepted_at >= invited_at),
  CHECK (revoked_at IS NULL OR revoked_at >= invited_at)
);

CREATE UNIQUE INDEX person_one_open_invitation
  ON nova.person_invitations (person_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE nova.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  actor_person_id uuid REFERENCES nova.people(id),
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{2,126}$'),
  target_type text NOT NULL CHECK (btrim(target_type) <> ''),
  target_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION nova.reject_protected_role_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_protected THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'PROTECTED_ROLE_MUTATION_NOT_ALLOWED';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roles_reject_protected_mutation
BEFORE UPDATE OR DELETE ON nova.roles
FOR EACH ROW EXECUTE FUNCTION nova.reject_protected_role_mutation();

CREATE FUNCTION nova.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'AUDIT_EVENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON nova.audit_events
FOR EACH ROW EXECUTE FUNCTION nova.reject_audit_mutation();

CREATE FUNCTION nova.validate_permission_grant_scope_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_organisation_id uuid;
  target_organisation_id uuid;
BEGIN
  SELECT organisation_id INTO role_organisation_id
  FROM nova.roles
  WHERE id = NEW.role_id;

  IF NEW.office_id IS NOT NULL THEN
    SELECT organisation_id INTO target_organisation_id
    FROM nova.offices
    WHERE id = NEW.office_id;

    IF target_organisation_id IS DISTINCT FROM role_organisation_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PERMISSION_SCOPE_ORGANISATION_MISMATCH';
    END IF;
  END IF;

  IF NEW.organisation_department_id IS NOT NULL THEN
    SELECT organisation_id INTO target_organisation_id
    FROM nova.organisation_departments
    WHERE id = NEW.organisation_department_id;

    IF target_organisation_id IS DISTINCT FROM role_organisation_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PERMISSION_SCOPE_ORGANISATION_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permission_grants_validate_scope_organisation
BEFORE INSERT OR UPDATE ON nova.role_permission_grants
FOR EACH ROW EXECUTE FUNCTION nova.validate_permission_grant_scope_organisation();

CREATE FUNCTION nova.validate_person_relationship_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
  related_organisation_id uuid;
BEGIN
  SELECT organisation_id INTO person_organisation_id
  FROM nova.people
  WHERE id = NEW.person_id;

  IF TG_TABLE_NAME = 'person_office_assignments' THEN
    SELECT organisation_id INTO related_organisation_id
    FROM nova.offices
    WHERE id = NEW.office_id;
  ELSIF TG_TABLE_NAME = 'person_department_assignments' THEN
    SELECT organisation_id INTO related_organisation_id
    FROM nova.organisation_departments
    WHERE id = NEW.organisation_department_id;
  ELSIF TG_TABLE_NAME = 'person_role_assignments' THEN
    SELECT organisation_id INTO related_organisation_id
    FROM nova.roles
    WHERE id = NEW.role_id;
  END IF;

  IF related_organisation_id IS DISTINCT FROM person_organisation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'PERSON_RELATIONSHIP_ORGANISATION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER person_office_assignments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.person_office_assignments
FOR EACH ROW EXECUTE FUNCTION nova.validate_person_relationship_organisation();

CREATE TRIGGER person_department_assignments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.person_department_assignments
FOR EACH ROW EXECUTE FUNCTION nova.validate_person_relationship_organisation();

CREATE TRIGGER person_role_assignments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.person_role_assignments
FOR EACH ROW EXECUTE FUNCTION nova.validate_person_relationship_organisation();

CREATE FUNCTION nova.validate_employment_manager_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
  manager_organisation_id uuid;
BEGIN
  IF NEW.manager_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organisation_id INTO person_organisation_id
  FROM nova.people
  WHERE id = NEW.person_id;

  SELECT organisation_id INTO manager_organisation_id
  FROM nova.people
  WHERE id = NEW.manager_person_id;

  IF manager_organisation_id IS DISTINCT FROM person_organisation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'MANAGER_ORGANISATION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER employment_terms_validate_manager_organisation
BEFORE INSERT OR UPDATE ON nova.employment_terms
FOR EACH ROW EXECUTE FUNCTION nova.validate_employment_manager_organisation();

CREATE FUNCTION nova.validate_audit_actor_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_organisation_id uuid;
BEGIN
  IF NEW.actor_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organisation_id INTO actor_organisation_id
  FROM nova.people
  WHERE id = NEW.actor_person_id;

  IF actor_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'AUDIT_ACTOR_ORGANISATION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_validate_actor_organisation
BEFORE INSERT ON nova.audit_events
FOR EACH ROW EXECUTE FUNCTION nova.validate_audit_actor_organisation();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('people.view', 'people', 'View people records within the granted scope.'),
  ('people.create', 'people', 'Create people records within the organisation.'),
  ('people.edit', 'people', 'Edit people records within the granted scope.'),
  ('people.freeze', 'people', 'Freeze people within the granted scope.'),
  ('people.offboard', 'people', 'Offboard people within the granted scope.'),
  ('clients.view', 'work_context', 'View client records within the granted scope.'),
  ('clients.create', 'work_context', 'Create client records within the granted scope.'),
  ('clients.edit', 'work_context', 'Edit client records within the granted scope.'),
  ('tasks.view', 'work_context', 'View tasks within the granted scope.'),
  ('tasks.create', 'work_context', 'Create tasks within the granted scope.'),
  ('tasks.edit', 'work_context', 'Edit tasks within the granted scope.'),
  ('tasks.assign', 'work_context', 'Assign people to tasks within the granted scope.'),
  ('tasks.reassign', 'work_context', 'Reassign task responsibility within the granted scope.'),
  ('tasks.start', 'work_time', 'Start work for an eligible assignment.'),
  ('tasks.submit', 'reviews', 'Submit an eligible assignment for review.'),
  ('tasks.review', 'reviews', 'Review an eligible assigned work item.'),
  ('attendance.view', 'availability', 'View attendance within the granted scope.'),
  ('attendance.check_in', 'availability', 'Check in when operational policy permits.'),
  ('attendance.check_out', 'availability', 'Check out when operational policy permits.'),
  ('attendance.recover', 'availability', 'Recover attendance within the granted scope.'),
  ('work.timeline.view', 'work_time', 'View work timelines within the granted scope.'),
  ('work.timeline_adjust_own', 'work_time', 'Adjust an eligible historical work gap on the actor''s own timeline.'),
  ('work.timeline_adjust_others', 'work_time', 'Adjust an eligible historical work gap within the granted scope.'),
  ('leave.request', 'availability', 'Request leave for the actor.'),
  ('leave.review', 'availability', 'Review leave within the granted scope.'),
  ('payroll.view', 'payroll', 'View future payroll records within the granted scope.'),
  ('payroll.manage', 'payroll', 'Manage future payroll records within the granted scope.'),
  ('payroll.lock', 'payroll', 'Lock future payroll records within the granted scope.')
ON CONFLICT (key) DO NOTHING;

-- RLS consumes only request context established by the trusted NOVA API
-- transaction. It does not evaluate domain permissions or operational policy.
CREATE FUNCTION nova.request_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('nova.user_id', true), '')::uuid;
$$;

CREATE FUNCTION nova.request_organisation_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('nova.organisation_id', true), '')::uuid;
$$;

-- SECURITY DEFINER avoids a self-reference when a people-table policy checks
-- whether the resolved actor belongs to the request organisation. It returns
-- only a boolean and does not evaluate NOVA permissions or policy.
CREATE FUNCTION nova.request_has_valid_actor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM nova.people
    WHERE id = nova.request_user_id()
      AND organisation_id = nova.request_organisation_id()
  );
$$;

-- The migration role owns these tables and may bypass RLS by PostgreSQL design.
-- Normal NOVA API requests must use a distinct non-owner role without BYPASSRLS.
ALTER TABLE nova.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.organisation_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.person_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.person_status_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.employment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.role_operational_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.role_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.person_office_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.person_department_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.person_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.person_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY organisations_request_organisation ON nova.organisations
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND id = nova.request_organisation_id()
);

CREATE POLICY offices_request_organisation ON nova.offices
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE POLICY departments_request_organisation ON nova.organisation_departments
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE POLICY people_request_organisation ON nova.people
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE POLICY identities_request_organisation ON nova.person_identities
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_identities.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_identities.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY status_periods_request_organisation ON nova.person_status_periods
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_status_periods.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_status_periods.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY employment_terms_request_organisation ON nova.employment_terms
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = employment_terms.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = employment_terms.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY roles_request_organisation ON nova.roles
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE POLICY role_policies_request_organisation ON nova.role_operational_policies
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.roles
    WHERE roles.id = role_operational_policies.role_id
      AND roles.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.roles
    WHERE roles.id = role_operational_policies.role_id
      AND roles.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY permissions_authenticated_read ON nova.permissions
FOR SELECT
USING (
  nova.request_has_valid_actor()
);

CREATE POLICY role_permission_grants_request_organisation
ON nova.role_permission_grants
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.roles
    WHERE roles.id = role_permission_grants.role_id
      AND roles.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.roles
    WHERE roles.id = role_permission_grants.role_id
      AND roles.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY office_assignments_request_organisation
ON nova.person_office_assignments
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_office_assignments.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_office_assignments.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY department_assignments_request_organisation
ON nova.person_department_assignments
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_department_assignments.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_department_assignments.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY role_assignments_request_organisation
ON nova.person_role_assignments
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_role_assignments.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_role_assignments.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY invitations_request_organisation ON nova.person_invitations
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_invitations.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1
    FROM nova.people
    WHERE people.id = person_invitations.person_id
      AND people.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY audit_events_request_organisation ON nova.audit_events
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
