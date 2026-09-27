-- NOVA Phase 2 foundation: portable availability configuration.
-- Attendance, WFH and leave consume these records in later migrations.

CREATE TABLE nova.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  start_local_time time NOT NULL,
  end_local_time time NOT NULL,
  break_start_local_time time,
  break_end_local_time time,
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 720),
  overtime_enabled boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_local_time > start_local_time),
  CHECK (
    (break_start_local_time IS NULL AND break_end_local_time IS NULL)
    OR (break_start_local_time IS NOT NULL AND break_end_local_time IS NOT NULL)
  ),
  CHECK (
    break_start_local_time IS NULL
    OR (
      break_start_local_time >= start_local_time
      AND break_end_local_time <= end_local_time
      AND break_end_local_time > break_start_local_time
    )
  ),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.working_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE nova.working_calendar_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES nova.working_calendars(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  ordinal smallint NOT NULL DEFAULT 0 CHECK (ordinal BETWEEN 0 AND 5),
  is_working boolean NOT NULL,
  shift_id uuid REFERENCES nova.shifts(id),
  CHECK ((is_working AND shift_id IS NOT NULL) OR (NOT is_working AND shift_id IS NULL)),
  UNIQUE (calendar_id, weekday, ordinal)
);

CREATE TABLE nova.office_calendar_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES nova.offices(id),
  calendar_id uuid NOT NULL REFERENCES nova.working_calendars(id),
  effective_on date NOT NULL,
  effective_until date,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_on),
  EXCLUDE USING gist (
    office_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  )
);

CREATE TABLE nova.office_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  office_id uuid NOT NULL REFERENCES nova.offices(id),
  holiday_date date NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_by_person_id uuid REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (office_id, holiday_date)
);

CREATE FUNCTION nova.validate_availability_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_organisation_id uuid;
  target_organisation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'working_calendar_rules' THEN
    SELECT organisation_id INTO expected_organisation_id
    FROM nova.working_calendars WHERE id = NEW.calendar_id;
    IF NEW.shift_id IS NOT NULL THEN
      SELECT organisation_id INTO target_organisation_id
      FROM nova.shifts WHERE id = NEW.shift_id;
      IF target_organisation_id IS DISTINCT FROM expected_organisation_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AVAILABILITY_ORGANISATION_MISMATCH';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'office_calendar_assignments' THEN
    SELECT organisation_id INTO expected_organisation_id
    FROM nova.offices WHERE id = NEW.office_id;
    SELECT organisation_id INTO target_organisation_id
    FROM nova.working_calendars WHERE id = NEW.calendar_id;
    IF target_organisation_id IS DISTINCT FROM expected_organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AVAILABILITY_ORGANISATION_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'office_holidays' THEN
    SELECT organisation_id INTO expected_organisation_id
    FROM nova.offices WHERE id = NEW.office_id;
    IF NEW.organisation_id IS DISTINCT FROM expected_organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AVAILABILITY_ORGANISATION_MISMATCH';
    END IF;
    IF NEW.created_by_person_id IS NOT NULL THEN
      SELECT organisation_id INTO target_organisation_id
      FROM nova.people WHERE id = NEW.created_by_person_id;
      IF target_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AVAILABILITY_ORGANISATION_MISMATCH';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER working_calendar_rules_validate_organisation
BEFORE INSERT OR UPDATE ON nova.working_calendar_rules
FOR EACH ROW EXECUTE FUNCTION nova.validate_availability_organisation();

CREATE TRIGGER office_calendar_assignments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.office_calendar_assignments
FOR EACH ROW EXECUTE FUNCTION nova.validate_availability_organisation();

CREATE TRIGGER office_holidays_validate_organisation
BEFORE INSERT OR UPDATE ON nova.office_holidays
FOR EACH ROW EXECUTE FUNCTION nova.validate_availability_organisation();

INSERT INTO nova.permissions (key, module, description) VALUES
  ('availability.calendar.view', 'availability', 'View working calendar configuration.'),
  ('availability.calendar.manage', 'availability', 'Create and assign working calendars.'),
  ('availability.shift.view', 'availability', 'View shift configuration.'),
  ('availability.shift.manage', 'availability', 'Create fixed shift configurations.'),
  ('availability.holiday.view', 'availability', 'View office holidays.'),
  ('availability.holiday.manage', 'availability', 'Manage office holidays.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN (
    'availability.calendar.view',
    'availability.calendar.manage',
    'availability.shift.view',
    'availability.shift.manage',
    'availability.holiday.view',
    'availability.holiday.manage'
  )
ON CONFLICT DO NOTHING;

ALTER TABLE nova.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.working_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.working_calendar_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.office_calendar_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.office_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY shifts_request_organisation ON nova.shifts
FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());

CREATE POLICY working_calendars_request_organisation ON nova.working_calendars
FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());

CREATE POLICY working_calendar_rules_request_organisation ON nova.working_calendar_rules
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1 FROM nova.working_calendars calendars
    WHERE calendars.id = working_calendar_rules.calendar_id
      AND calendars.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1 FROM nova.working_calendars calendars
    WHERE calendars.id = working_calendar_rules.calendar_id
      AND calendars.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY office_calendar_assignments_request_organisation ON nova.office_calendar_assignments
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1 FROM nova.offices offices
    WHERE offices.id = office_calendar_assignments.office_id
      AND offices.organisation_id = nova.request_organisation_id()
  )
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND EXISTS (
    SELECT 1 FROM nova.offices offices
    WHERE offices.id = office_calendar_assignments.office_id
      AND offices.organisation_id = nova.request_organisation_id()
  )
);

CREATE POLICY office_holidays_request_organisation ON nova.office_holidays
FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
