-- NOVA Phase 2 completion: approved WFH requests and office attendance
-- geofence evidence. Policy eligibility remains separate from approval.

ALTER TABLE nova.offices
  ADD COLUMN latitude numeric(8,5),
  ADD COLUMN longitude numeric(8,5),
  ADD COLUMN attendance_geofence_radius_meters integer NOT NULL DEFAULT 150,
  ADD CONSTRAINT offices_latitude_valid
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT offices_longitude_valid
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT offices_geo_reference_pair
    CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
  ADD CONSTRAINT offices_geofence_radius_valid
    CHECK (attendance_geofence_radius_meters BETWEEN 10 AND 100000);

CREATE TYPE nova.wfh_request_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'cancelled'
);

CREATE TABLE nova.wfh_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 2000),
  status nova.wfh_request_status NOT NULL DEFAULT 'pending',
  reviewer_person_id uuid REFERENCES nova.people(id),
  reviewed_at timestamptz,
  review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (status = 'cancelled' OR reviewer_person_id IS NULL OR reviewer_person_id <> person_id),
  CHECK ((status = 'pending' AND reviewer_person_id IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected', 'cancelled')
      AND reviewer_person_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(start_date, end_date + 1, '[)') WITH &&
  ) WHERE (status IN ('pending', 'approved'))
);

CREATE INDEX wfh_requests_person_status_dates
  ON nova.wfh_requests (person_id, status, start_date, end_date);

CREATE FUNCTION nova.validate_wfh_request_organisation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  person_organisation_id uuid;
  reviewer_organisation_id uuid;
BEGIN
  SELECT organisation_id INTO person_organisation_id
  FROM nova.people
  WHERE id = NEW.person_id;

  IF NEW.organisation_id IS DISTINCT FROM person_organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WFH_REQUEST_ORGANISATION_MISMATCH';
  END IF;

  IF NEW.reviewer_person_id IS NOT NULL THEN
    SELECT organisation_id INTO reviewer_organisation_id
    FROM nova.people
    WHERE id = NEW.reviewer_person_id;
    IF reviewer_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'WFH_REVIEWER_ORGANISATION_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER wfh_requests_validate_organisation
BEFORE INSERT OR UPDATE ON nova.wfh_requests
FOR EACH ROW EXECUTE FUNCTION nova.validate_wfh_request_organisation();

CREATE FUNCTION nova.wfh_request_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wfh_requests_touch_updated_at
BEFORE UPDATE ON nova.wfh_requests
FOR EACH ROW EXECUTE FUNCTION nova.wfh_request_touch_updated_at();

ALTER TABLE nova.attendance_days
  ADD COLUMN check_in_latitude numeric(8,5),
  ADD COLUMN check_in_longitude numeric(8,5),
  ADD COLUMN check_in_accuracy_meters numeric(8,2),
  ADD COLUMN check_in_distance_meters numeric(10,2),
  ADD CONSTRAINT attendance_location_evidence_complete
    CHECK (
      (check_in_latitude IS NULL AND check_in_longitude IS NULL
        AND check_in_accuracy_meters IS NULL AND check_in_distance_meters IS NULL)
      OR (check_in_latitude IS NOT NULL AND check_in_longitude IS NOT NULL
        AND check_in_accuracy_meters IS NOT NULL AND check_in_distance_meters IS NOT NULL)
    ),
  ADD CONSTRAINT attendance_location_evidence_valid
    CHECK (
      (check_in_latitude IS NULL OR check_in_latitude BETWEEN -90 AND 90)
      AND (check_in_longitude IS NULL OR check_in_longitude BETWEEN -180 AND 180)
      AND (check_in_accuracy_meters IS NULL OR check_in_accuracy_meters >= 0)
      AND (check_in_distance_meters IS NULL OR check_in_distance_meters >= 0)
    );

INSERT INTO nova.permissions (key, module, description) VALUES
  ('availability.wfh.request', 'availability', 'Request WFH for the actor for specific business dates.'),
  ('availability.wfh.review', 'availability', 'Review WFH requests within the granted scope.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND permissions.key IN ('availability.wfh.request', 'availability.wfh.review')
ON CONFLICT DO NOTHING;

ALTER TABLE nova.wfh_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY wfh_requests_request_organisation ON nova.wfh_requests
FOR ALL
USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
);
