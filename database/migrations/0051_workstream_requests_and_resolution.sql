-- NOVA collaboration hardening: self-work, reviewer requests, handovers and
-- explicit resolution provenance. This remains provider-neutral PostgreSQL.

CREATE TYPE nova.task_reviewer_request_status AS ENUM (
  'pending', 'accepted', 'declined', 'withdrawn', 'expired'
);

CREATE TYPE nova.task_handover_request_status AS ENUM (
  'pending', 'accepted', 'declined', 'withdrawn', 'expired'
);

INSERT INTO nova.permissions (key, module, description) VALUES
  ('tasks.reviewer_request', 'work_context', 'Request or replace a reviewer for the actor''s assignment.'),
  ('tasks.handover_request', 'work_context', 'Request handover of the actor''s assignment to another person.'),
  ('tasks.handover_accept', 'work_context', 'Accept a handover request addressed to the actor.')
ON CONFLICT (key) DO NOTHING;

UPDATE nova.permissions
SET allowed_scopes = CASE key
  WHEN 'tasks.review' THEN ARRAY['organisation', 'client', 'client_workstream', 'group', 'assigned_work']::nova.permission_scope[]
  WHEN 'tasks.reviewer_request' THEN ARRAY['organisation', 'client', 'client_workstream', 'group', 'assigned_work']::nova.permission_scope[]
  WHEN 'tasks.handover_request' THEN ARRAY['organisation', 'client', 'client_workstream', 'group', 'assigned_work']::nova.permission_scope[]
  WHEN 'tasks.handover_accept' THEN ARRAY['organisation', 'client', 'client_workstream', 'group', 'assigned_work']::nova.permission_scope[]
  ELSE allowed_scopes
END
WHERE key IN ('tasks.review', 'tasks.reviewer_request', 'tasks.handover_request', 'tasks.handover_accept');

INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
SELECT roles.id, permissions.key, 'organisation'::nova.permission_scope
FROM nova.roles
CROSS JOIN nova.permissions
WHERE roles.key = 'super_admin'
  AND roles.is_protected
  AND permissions.key IN ('tasks.reviewer_request', 'tasks.handover_request', 'tasks.handover_accept')
ON CONFLICT DO NOTHING;

ALTER TABLE nova.task_assignments
  ADD COLUMN resolution_source text;

UPDATE nova.task_assignments
SET resolution_source = 'review'
WHERE status = 'approved' AND resolution_source IS NULL;

ALTER TABLE nova.task_assignments
  ADD CONSTRAINT task_assignments_resolution_source_valid CHECK (
    (status = 'approved' AND resolution_source IN ('review', 'policy'))
    OR (status <> 'approved' AND resolution_source IS NULL)
  );

ALTER TABLE nova.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_review_blocked_complete;

ALTER TABLE nova.task_assignments
  ADD CONSTRAINT task_assignments_review_blocked_complete CHECK (
    (review_blocked_reason IS NULL AND review_blocked_at IS NULL)
    OR (
      review_required
      AND reviewer_person_id IS NULL
      AND review_blocked_reason IN ('NO_ELIGIBLE_REVIEWER', 'REVIEWER_UNAVAILABLE')
      AND review_blocked_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION nova.validate_review_cycle_reviewer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  assignment_status nova.assignment_status;
  blocked_reason text;
BEGIN
  IF NEW.reviewer_person_id IS NULL THEN
    SELECT assignments.status, assignments.review_blocked_reason
      INTO assignment_status, blocked_reason
    FROM nova.task_assignments assignments
    WHERE assignments.id = NEW.assignment_id;

    IF assignment_status IS DISTINCT FROM 'awaiting_review'::nova.assignment_status
       OR blocked_reason IS NULL
       OR blocked_reason NOT IN ('NO_ELIGIBLE_REVIEWER', 'REVIEWER_UNAVAILABLE') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVIEW_CYCLE_REVIEWER_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE nova.task_reviewer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  assignment_id uuid NOT NULL REFERENCES nova.task_assignments(id),
  requester_person_id uuid NOT NULL REFERENCES nova.people(id),
  candidate_reviewer_person_id uuid NOT NULL REFERENCES nova.people(id),
  request_kind text NOT NULL CHECK (request_kind IN ('initial', 'replacement')),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  status nova.task_reviewer_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '7 days'),
  resolved_at timestamptz,
  resolved_by_person_id uuid REFERENCES nova.people(id),
  resolution_reason text,
  CHECK (requester_person_id <> candidate_reviewer_person_id),
  CHECK (expires_at > created_at),
  CHECK ((status = 'pending' AND resolved_at IS NULL AND resolved_by_person_id IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by_person_id IS NOT NULL)),
  CHECK (resolution_reason IS NULL OR (btrim(resolution_reason) <> '' AND length(resolution_reason) <= 2000))
);

CREATE UNIQUE INDEX task_reviewer_requests_one_pending
  ON nova.task_reviewer_requests (assignment_id)
  WHERE status = 'pending';
CREATE INDEX task_reviewer_requests_candidate_pending
  ON nova.task_reviewer_requests (candidate_reviewer_person_id, status, created_at)
  WHERE status = 'pending';
CREATE INDEX task_reviewer_requests_requester
  ON nova.task_reviewer_requests (requester_person_id, created_at DESC);

CREATE FUNCTION nova.validate_task_reviewer_request_organisation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  assignment_organisation_id uuid;
  assignment_person_id uuid;
  requester_organisation_id uuid;
  candidate_organisation_id uuid;
BEGIN
  SELECT organisation_id, person_id
    INTO assignment_organisation_id, assignment_person_id
  FROM nova.task_assignments
  WHERE id = NEW.assignment_id;
  SELECT organisation_id INTO requester_organisation_id FROM nova.people WHERE id = NEW.requester_person_id;
  SELECT organisation_id INTO candidate_organisation_id FROM nova.people WHERE id = NEW.candidate_reviewer_person_id;
  IF assignment_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR requester_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR candidate_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR assignment_person_id IS DISTINCT FROM NEW.requester_person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_REVIEWER_REQUEST_ORGANISATION_MISMATCH';
  END IF;
  IF NEW.requester_person_id = NEW.candidate_reviewer_person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_REVIEWER_REQUEST_SELF_REVIEW';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_reviewer_requests_validate_organisation
BEFORE INSERT OR UPDATE ON nova.task_reviewer_requests
FOR EACH ROW EXECUTE FUNCTION nova.validate_task_reviewer_request_organisation();

CREATE TABLE nova.task_assignment_handover_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  assignment_id uuid NOT NULL REFERENCES nova.task_assignments(id),
  requester_person_id uuid NOT NULL REFERENCES nova.people(id),
  target_person_id uuid NOT NULL REFERENCES nova.people(id),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  status nova.task_handover_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '7 days'),
  resolved_at timestamptz,
  resolved_by_person_id uuid REFERENCES nova.people(id),
  resolution_reason text,
  CHECK (requester_person_id <> target_person_id),
  CHECK (expires_at > created_at),
  CHECK ((status = 'pending' AND resolved_at IS NULL AND resolved_by_person_id IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by_person_id IS NOT NULL)),
  CHECK (resolution_reason IS NULL OR (btrim(resolution_reason) <> '' AND length(resolution_reason) <= 2000))
);

CREATE UNIQUE INDEX task_handover_requests_one_pending
  ON nova.task_assignment_handover_requests (assignment_id)
  WHERE status = 'pending';
CREATE INDEX task_handover_requests_target_pending
  ON nova.task_assignment_handover_requests (target_person_id, status, created_at)
  WHERE status = 'pending';
CREATE INDEX task_handover_requests_requester
  ON nova.task_assignment_handover_requests (requester_person_id, created_at DESC);

CREATE FUNCTION nova.validate_task_handover_request_organisation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = nova, pg_catalog
AS $$
DECLARE
  assignment_organisation_id uuid;
  assignment_person_id uuid;
  requester_organisation_id uuid;
  target_organisation_id uuid;
BEGIN
  SELECT organisation_id, person_id
    INTO assignment_organisation_id, assignment_person_id
  FROM nova.task_assignments
  WHERE id = NEW.assignment_id;
  SELECT organisation_id INTO requester_organisation_id FROM nova.people WHERE id = NEW.requester_person_id;
  SELECT organisation_id INTO target_organisation_id FROM nova.people WHERE id = NEW.target_person_id;
  IF assignment_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR requester_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR target_organisation_id IS DISTINCT FROM NEW.organisation_id
     OR assignment_person_id IS DISTINCT FROM NEW.requester_person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_HANDOVER_REQUEST_ORGANISATION_MISMATCH';
  END IF;
  IF NEW.requester_person_id = NEW.target_person_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TASK_HANDOVER_REQUEST_SELF_TARGET';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_handover_requests_validate_organisation
BEFORE INSERT OR UPDATE ON nova.task_assignment_handover_requests
FOR EACH ROW EXECUTE FUNCTION nova.validate_task_handover_request_organisation();

ALTER TABLE nova.task_reviewer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova.task_assignment_handover_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_reviewer_requests_request_organisation
ON nova.task_reviewer_requests FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());

CREATE POLICY task_handover_requests_request_organisation
ON nova.task_assignment_handover_requests FOR ALL
USING (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id())
WITH CHECK (nova.request_has_valid_actor() AND organisation_id = nova.request_organisation_id());

GRANT SELECT, INSERT, UPDATE ON nova.task_reviewer_requests TO nova_app;
GRANT SELECT, INSERT, UPDATE ON nova.task_assignment_handover_requests TO nova_app;
GRANT EXECUTE ON FUNCTION nova.close_person_work_sessions(uuid, timestamptz, text) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.close_assignment_work_sessions(uuid, timestamptz, text) TO nova_app;
