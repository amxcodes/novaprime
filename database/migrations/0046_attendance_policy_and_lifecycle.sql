-- Organisation-wide attendance interpretation and canonical lifecycle closure.
-- The policy is effective-dated so changing hour-based/scheduled behaviour never
-- rewrites how historical timelines are interpreted.

DO $$
BEGIN
  CREATE TYPE nova.attendance_policy_mode AS ENUM ('hour_based', 'scheduled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE nova.organisation_attendance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  effective_on date NOT NULL,
  effective_until date,
  mode nova.attendance_policy_mode NOT NULL,
  required_attendance_minutes integer NOT NULL DEFAULT 480
    CHECK (required_attendance_minutes BETWEEN 1 AND 1440),
  created_by_person_id uuid REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  EXCLUDE USING gist (
    organisation_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  )
);

CREATE INDEX organisation_attendance_policies_lookup
  ON nova.organisation_attendance_policies (organisation_id, effective_on DESC);

-- Existing organisations receive the safe historical default. New bootstrap
-- calls insert their selected policy atomically.
INSERT INTO nova.organisation_attendance_policies (organisation_id, effective_on, mode)
SELECT organisations.id, current_date, 'hour_based'::nova.attendance_policy_mode
FROM nova.organisations
WHERE NOT EXISTS (
  SELECT 1
  FROM nova.organisation_attendance_policies policies
  WHERE policies.organisation_id = organisations.id
);

CREATE FUNCTION nova.validate_organisation_attendance_policy_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
BEGIN
  IF NEW.created_by_person_id IS NOT NULL THEN
    SELECT organisation_id INTO person_organisation_id
    FROM nova.people
    WHERE id = NEW.created_by_person_id;
    IF person_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ATTENDANCE_POLICY_ORGANISATION_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisation_attendance_policies_validate_organisation
BEFORE INSERT OR UPDATE ON nova.organisation_attendance_policies
FOR EACH ROW EXECUTE FUNCTION nova.validate_organisation_attendance_policy_organisation();

ALTER TABLE nova.organisation_attendance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY organisation_attendance_policies_request_organisation
ON nova.organisation_attendance_policies
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE FUNCTION nova.bootstrap_organisation(
  p_organisation_name text,
  p_person_email text,
  p_person_display_name text,
  p_identity_subject text,
  p_attendance_mode nova.attendance_policy_mode,
  p_required_attendance_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  organisation_id uuid;
  person_id uuid;
  super_admin_role_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('nova.bootstrap_organisation'));

  IF EXISTS (SELECT 1 FROM nova.organisations) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED';
  END IF;

  IF btrim(p_organisation_name) = ''
    OR btrim(p_person_email) = ''
    OR p_person_email <> lower(p_person_email)
    OR btrim(p_person_display_name) = ''
    OR btrim(p_identity_subject) = ''
    OR p_required_attendance_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ORGANISATION_BOOTSTRAP_INPUT_INVALID';
  END IF;

  INSERT INTO nova.organisations (name)
  VALUES (btrim(p_organisation_name))
  RETURNING id INTO organisation_id;

  INSERT INTO nova.organisation_attendance_policies (
    organisation_id, effective_on, mode, required_attendance_minutes
  ) VALUES (
    organisation_id, current_date, p_attendance_mode,
    p_required_attendance_minutes
  );

  INSERT INTO nova.roles (organisation_id, key, name, is_protected)
  VALUES (organisation_id, 'super_admin', 'Super Admin', true)
  RETURNING id INTO super_admin_role_id;

  INSERT INTO nova.role_operational_policies (role_id)
  VALUES (super_admin_role_id);

  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
  SELECT super_admin_role_id, key, 'organisation'::nova.permission_scope
  FROM nova.permissions;

  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (organisation_id, p_person_email, btrim(p_person_display_name))
  RETURNING id INTO person_id;

  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (person_id, 'better_auth', p_identity_subject);

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (person_id, 'active', now());

  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (person_id, super_admin_role_id, current_date);

  INSERT INTO nova.audit_events (
    organisation_id, actor_person_id, action, target_type, target_id, details
  )
  VALUES (
    organisation_id,
    person_id,
    'organisation.bootstrap',
    'organisation',
    organisation_id,
    jsonb_build_object(
      'identity_provider', 'better_auth',
      'attendance_mode', p_attendance_mode,
      'required_attendance_minutes', p_required_attendance_minutes
    )
  );

  RETURN organisation_id;
END;
$$;

-- Keep old fixture callers valid while the API uses the explicit policy form.
CREATE OR REPLACE FUNCTION nova.bootstrap_organisation(
  p_organisation_name text,
  p_person_email text,
  p_person_display_name text,
  p_identity_subject text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT nova.bootstrap_organisation(
    p_organisation_name,
    p_person_email,
    p_person_display_name,
    p_identity_subject,
    'hour_based'::nova.attendance_policy_mode,
    480
  )
$$;

REVOKE ALL ON FUNCTION nova.bootstrap_organisation(text, text, text, text, nova.attendance_policy_mode, integer) FROM PUBLIC;

-- One canonical operation for freeze/offboarding and other lifecycle paths.
CREATE FUNCTION nova.close_person_attendance(
  p_person_id uuid,
  p_effective_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  UPDATE nova.attendance_days
  SET checked_out_at = GREATEST(
    p_effective_at,
    checked_in_at + interval '1 microsecond'
  )
  WHERE person_id = p_person_id
    AND checked_out_at IS NULL
    AND checked_in_at <= p_effective_at;

  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.close_person_attendance(uuid, timestamptz) FROM PUBLIC;
