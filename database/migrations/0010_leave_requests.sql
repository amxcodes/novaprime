-- NOVA Phase 2: leave requests and per-business-day portions.
-- Leave is a separate source of truth from attendance; approved leave only
-- changes attendance eligibility through the domain command layer.

CREATE TYPE nova.leave_request_status AS ENUM (
  'requested',
  'pending',
  'approved',
  'rejected',
  'cancelled'
);

CREATE TABLE nova.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  leave_type text NOT NULL CHECK (btrim(leave_type) <> '' AND length(leave_type) <= 80),
  status nova.leave_request_status NOT NULL DEFAULT 'pending',
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 2000),
  reviewer_person_id uuid REFERENCES nova.people(id),
  reviewed_at timestamptz,
  review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK ((status IN ('requested', 'pending') AND reviewer_person_id IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected', 'cancelled') AND reviewer_person_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE TABLE nova.leave_request_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  request_id uuid NOT NULL REFERENCES nova.leave_requests(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES nova.people(id),
  business_date date NOT NULL,
  portion numeric(2,1) NOT NULL CHECK (portion IN (0.5, 1.0)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, business_date)
);

CREATE INDEX leave_requests_person_status_dates
  ON nova.leave_requests (person_id, status, start_date, end_date);

CREATE INDEX leave_request_days_person_date
  ON nova.leave_request_days (person_id, business_date);

CREATE FUNCTION nova.validate_leave_request_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_organisation_id uuid;
  person_organisation_id uuid;
  request_start_date date;
  request_end_date date;
  reviewer_organisation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'leave_request_days' THEN
    SELECT organisation_id, person_id, start_date, end_date
    INTO request_organisation_id, person_organisation_id, request_start_date, request_end_date
    FROM nova.leave_requests WHERE id = NEW.request_id;
    IF NEW.organisation_id IS DISTINCT FROM request_organisation_id
       OR NEW.person_id IS DISTINCT FROM person_organisation_id
       OR NEW.business_date < request_start_date
       OR NEW.business_date > request_end_date THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LEAVE_REQUEST_DAY_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  SELECT organisation_id INTO person_organisation_id
  FROM nova.people WHERE id = NEW.person_id;
  IF NEW.organisation_id IS DISTINCT FROM person_organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LEAVE_REQUEST_ORGANISATION_MISMATCH';
  END IF;
  IF NEW.reviewer_person_id IS NOT NULL THEN
    SELECT organisation_id INTO reviewer_organisation_id
    FROM nova.people WHERE id = NEW.reviewer_person_id;
    IF reviewer_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LEAVE_REVIEWER_ORGANISATION_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leave_requests_validate_organisation
BEFORE INSERT OR UPDATE ON nova.leave_requests
FOR EACH ROW EXECUTE FUNCTION nova.validate_leave_request_organisation();

CREATE TRIGGER leave_request_days_validate_organisation
BEFORE INSERT OR UPDATE ON nova.leave_request_days
FOR EACH ROW EXECUTE FUNCTION nova.validate_leave_request_organisation();

CREATE FUNCTION nova.ensure_leave_request_no_overlap(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  request_person_id uuid;
  day_record record;
BEGIN
  SELECT person_id INTO request_person_id
  FROM nova.leave_requests WHERE id = p_request_id;
  FOR day_record IN
    SELECT business_date FROM nova.leave_request_days WHERE request_id = p_request_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      request_person_id::text || ':' || day_record.business_date::text, 0
    ));
    IF EXISTS (
      SELECT 1
      FROM nova.leave_request_days days
      JOIN nova.leave_requests other ON other.id = days.request_id
      WHERE days.person_id = request_person_id
        AND days.business_date = day_record.business_date
        AND days.request_id <> p_request_id
        AND other.status IN ('requested', 'pending', 'approved')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'LEAVE_REQUEST_OVERLAP';
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION nova.validate_leave_request_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_id uuid;
  request_status nova.leave_request_status;
BEGIN
  IF TG_TABLE_NAME = 'leave_request_days' THEN
    request_id := NEW.request_id;
  ELSE
    request_id := NEW.id;
  END IF;
  SELECT status INTO request_status
  FROM nova.leave_requests
  WHERE id = request_id;
  IF request_status IN ('requested', 'pending', 'approved') THEN
    PERFORM nova.ensure_leave_request_no_overlap(request_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leave_request_days_validate_overlap
AFTER INSERT OR UPDATE ON nova.leave_request_days
FOR EACH ROW EXECUTE FUNCTION nova.validate_leave_request_overlap();

CREATE TRIGGER leave_requests_validate_overlap
AFTER INSERT OR UPDATE OF status ON nova.leave_requests
FOR EACH ROW EXECUTE FUNCTION nova.validate_leave_request_overlap();

CREATE FUNCTION nova.leave_request_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leave_requests_touch_updated_at
BEFORE UPDATE ON nova.leave_requests
FOR EACH ROW
EXECUTE FUNCTION nova.leave_request_touch_updated_at();

ALTER TABLE nova.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.leave_request_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_requests_request_organisation ON nova.leave_requests
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

CREATE POLICY leave_request_days_request_organisation ON nova.leave_request_days
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('leave.request', 'leave.review')
ON CONFLICT DO NOTHING;
