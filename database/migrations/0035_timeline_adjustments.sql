-- Past-only, auditable timeline corrections. These are not timer sessions and
-- never rewrite timer-backed history.

CREATE TABLE nova.work_timeline_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  assignment_id uuid REFERENCES nova.task_assignments(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  created_by_person_id uuid NOT NULL REFERENCES nova.people(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ended_at > started_at),
  EXCLUDE USING gist (
    person_id WITH =,
    tstzrange(started_at, ended_at, '[)') WITH &&
  )
);

CREATE INDEX work_timeline_adjustments_person_time
  ON nova.work_timeline_adjustments (person_id, started_at DESC);

CREATE FUNCTION nova.reject_timeline_adjustment_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.person_id::text, 0));
  IF EXISTS (
    SELECT 1
    FROM nova.work_sessions sessions
    WHERE sessions.person_id = NEW.person_id
      AND tstzrange(sessions.started_at, COALESCE(sessions.ended_at, 'infinity'::timestamptz), '[)')
          && tstzrange(NEW.started_at, NEW.ended_at, '[)')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'TIMELINE_ADJUSTMENT_WORK_SESSION_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_timeline_adjustments_reject_work_overlap
BEFORE INSERT OR UPDATE ON nova.work_timeline_adjustments
FOR EACH ROW EXECUTE FUNCTION nova.reject_timeline_adjustment_overlap();

CREATE FUNCTION nova.reject_work_session_timeline_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.person_id::text, 0));
  IF EXISTS (
    SELECT 1
    FROM nova.work_timeline_adjustments adjustments
    WHERE adjustments.person_id = NEW.person_id
      AND tstzrange(adjustments.started_at, adjustments.ended_at, '[)')
          && tstzrange(NEW.started_at, COALESCE(NEW.ended_at, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'WORK_SESSION_TIMELINE_ADJUSTMENT_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_sessions_reject_timeline_overlap
BEFORE INSERT OR UPDATE ON nova.work_sessions
FOR EACH ROW EXECUTE FUNCTION nova.reject_work_session_timeline_overlap();

CREATE FUNCTION nova.validate_timeline_adjustment_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_organisation_id uuid;
  assignment_person_id uuid;
BEGIN
  IF NEW.created_by_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM nova.people WHERE id = NEW.created_by_person_id AND organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TIMELINE_ADJUSTMENT_ACTOR_ORGANISATION_MISMATCH';
  END IF;
  IF NEW.assignment_id IS NOT NULL THEN
    SELECT organisation_id, person_id INTO assignment_organisation_id, assignment_person_id
    FROM nova.task_assignments WHERE id = NEW.assignment_id;
    IF assignment_organisation_id IS DISTINCT FROM NEW.organisation_id OR assignment_person_id IS DISTINCT FROM NEW.person_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TIMELINE_ADJUSTMENT_ASSIGNMENT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_timeline_adjustments_validate_organisation
BEFORE INSERT OR UPDATE ON nova.work_timeline_adjustments
FOR EACH ROW EXECUTE FUNCTION nova.validate_timeline_adjustment_organisation();

ALTER TABLE nova.work_timeline_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_timeline_adjustments_request_organisation ON nova.work_timeline_adjustments
FOR ALL USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());
