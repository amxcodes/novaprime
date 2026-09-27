-- Explicit, auditable attendance correction path for missed check-ins,
-- checkout/device failures, and approved historical recovery.

CREATE TABLE nova.attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  attendance_day_id uuid REFERENCES nova.attendance_days(id),
  business_date date NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  corrected_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_corrections_person_date
  ON nova.attendance_corrections (person_id, business_date, created_at DESC);

CREATE FUNCTION nova.validate_attendance_correction_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
  actor_organisation_id uuid;
  attendance_organisation_id uuid;
BEGIN
  SELECT organisation_id INTO person_organisation_id FROM nova.people WHERE id = NEW.person_id;
  SELECT organisation_id INTO actor_organisation_id FROM nova.people WHERE id = NEW.corrected_by_person_id;
  IF NEW.organisation_id IS DISTINCT FROM person_organisation_id
     OR NEW.organisation_id IS DISTINCT FROM actor_organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ATTENDANCE_CORRECTION_ORGANISATION_MISMATCH';
  END IF;
  IF NEW.attendance_day_id IS NOT NULL THEN
    SELECT organisation_id INTO attendance_organisation_id
    FROM nova.attendance_days WHERE id = NEW.attendance_day_id;
    IF NEW.organisation_id IS DISTINCT FROM attendance_organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ATTENDANCE_CORRECTION_ATTENDANCE_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_corrections_validate_organisation
BEFORE INSERT OR UPDATE ON nova.attendance_corrections
FOR EACH ROW EXECUTE FUNCTION nova.validate_attendance_correction_organisation();

ALTER TABLE nova.attendance_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_corrections_request_organisation ON nova.attendance_corrections
FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
