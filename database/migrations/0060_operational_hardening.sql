-- NOVA operational hardening: expired collaboration requests, temporal safety,
-- valid timezone data, and durable mutation idempotency.

CREATE OR REPLACE FUNCTION nova.is_valid_timezone(p_timezone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = btrim(p_timezone)
  );
$$;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT pg_constraint.conname
    FROM pg_constraint
    WHERE pg_constraint.conrelid = 'nova.shifts'::regclass
      AND pg_get_constraintdef(pg_constraint.oid) LIKE '%end_local_time > start_local_time%'
  LOOP
    EXECUTE format('ALTER TABLE nova.shifts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE nova.shifts
  ADD COLUMN IF NOT EXISTS spans_midnight boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nova.shifts'::regclass AND conname = 'shifts_local_time_order'
  ) THEN
    ALTER TABLE nova.shifts
      ADD CONSTRAINT shifts_local_time_order
      CHECK (end_local_time <> start_local_time AND (end_local_time > start_local_time OR spans_midnight));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nova.shifts'::regclass AND conname = 'shifts_overnight_break_unsupported'
  ) THEN
    ALTER TABLE nova.shifts
      ADD CONSTRAINT shifts_overnight_break_unsupported
      CHECK (NOT spans_midnight OR (break_start_local_time IS NULL AND break_end_local_time IS NULL));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nova.offices'::regclass AND conname = 'offices_timezone_valid'
  ) THEN
    ALTER TABLE nova.offices
      ADD CONSTRAINT offices_timezone_valid CHECK (nova.is_valid_timezone(timezone));
  END IF;
END;
$$;

-- Expiry is a system resolution, so it has no human resolver. Keep the
-- existing provenance rule for human decisions while allowing this explicit
-- system-owned terminal state.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT conrelid::regclass AS relation_name, conname
    FROM pg_constraint
    WHERE conrelid IN (
      'nova.task_reviewer_requests'::regclass,
      'nova.task_assignment_handover_requests'::regclass
    )
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status = ''pending''%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.relation_name, item.conname);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nova.task_reviewer_requests'::regclass
      AND conname = 'task_reviewer_requests_resolution_consistency'
  ) THEN
    ALTER TABLE nova.task_reviewer_requests
      ADD CONSTRAINT task_reviewer_requests_resolution_consistency CHECK (
        (status = 'pending' AND resolved_at IS NULL AND resolved_by_person_id IS NULL)
        OR (status = 'expired' AND resolved_at IS NOT NULL)
        OR (status NOT IN ('pending', 'expired') AND resolved_at IS NOT NULL AND resolved_by_person_id IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nova.task_assignment_handover_requests'::regclass
      AND conname = 'task_handover_requests_resolution_consistency'
  ) THEN
    ALTER TABLE nova.task_assignment_handover_requests
      ADD CONSTRAINT task_handover_requests_resolution_consistency CHECK (
        (status = 'pending' AND resolved_at IS NULL AND resolved_by_person_id IS NULL)
        OR (status = 'expired' AND resolved_at IS NOT NULL)
        OR (status NOT IN ('pending', 'expired') AND resolved_at IS NOT NULL AND resolved_by_person_id IS NOT NULL)
      );
  END IF;
END;
$$;

-- An idempotency key is scoped to actor + command + organisation. The
-- transaction advisory lock prevents two identical retries from both creating
-- a row before either response has been persisted.
CREATE TABLE IF NOT EXISTS nova.api_idempotency_keys (
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  actor_person_id uuid NOT NULL REFERENCES nova.people(id),
  command text NOT NULL CHECK (btrim(command) <> '' AND length(command) <= 120),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours'),
  PRIMARY KEY (organisation_id, actor_person_id, command, idempotency_key)
);

CREATE INDEX IF NOT EXISTS api_idempotency_keys_expiry
  ON nova.api_idempotency_keys (expires_at);

CREATE OR REPLACE FUNCTION nova.purge_expired_api_idempotency_keys(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM nova.api_idempotency_keys
  WHERE ctid IN (
    SELECT ctid FROM nova.api_idempotency_keys
    WHERE expires_at <= clock_timestamp()
    ORDER BY expires_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000)
    FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

ALTER TABLE nova.api_idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'nova.api_idempotency_keys'::regclass
      AND polname = 'api_idempotency_keys_actor'
  ) THEN
    CREATE POLICY api_idempotency_keys_actor ON nova.api_idempotency_keys
      FOR ALL
      USING (
        nova.request_has_valid_actor()
        AND organisation_id = nova.request_organisation_id()
        AND actor_person_id = nova.request_user_id()
      )
      WITH CHECK (
        nova.request_has_valid_actor()
        AND organisation_id = nova.request_organisation_id()
        AND actor_person_id = nova.request_user_id()
      );
  END IF;
END;
$$;

GRANT SELECT, INSERT ON nova.api_idempotency_keys TO nova_app;

CREATE OR REPLACE FUNCTION nova.expire_task_requests(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  item record;
  expired_count integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TASK_REQUEST_EXPIRY_INPUT_INVALID';
  END IF;

  FOR item IN
    SELECT id, organisation_id, assignment_id, requester_person_id
    FROM nova.task_reviewer_requests
    WHERE status = 'pending' AND expires_at <= clock_timestamp()
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE nova.task_reviewer_requests
    SET status = 'expired', resolved_at = clock_timestamp(),
        resolution_reason = 'Request expired'
    WHERE id = item.id AND status = 'pending';

    INSERT INTO nova.audit_events (
      organisation_id, actor_person_id, action, target_type, target_id, details
    ) VALUES (
      item.organisation_id, NULL, 'tasks.reviewer_request_expired',
      'task_reviewer_request', item.id,
      jsonb_build_object('assignment_id', item.assignment_id)
    );

    INSERT INTO nova.notifications (
      organisation_id, recipient_person_id, event_key, title, body,
      aggregate_type, aggregate_id, deep_link, idempotency_key
    ) VALUES (
      item.organisation_id, item.requester_person_id, 'task.reviewer_request_expired',
      'Reviewer request expired', 'Your reviewer request expired. Choose another reviewer.',
      'task_reviewer_request', item.id, '/?view=work&assignment=' || item.assignment_id,
      'task.reviewer_request_expired:' || item.id
    ) ON CONFLICT (recipient_person_id, idempotency_key) DO NOTHING;

    expired_count := expired_count + 1;
  END LOOP;

  FOR item IN
    SELECT id, organisation_id, assignment_id, requester_person_id
    FROM nova.task_assignment_handover_requests
    WHERE status = 'pending' AND expires_at <= clock_timestamp()
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE nova.task_assignment_handover_requests
    SET status = 'expired', resolved_at = clock_timestamp(),
        resolution_reason = 'Request expired'
    WHERE id = item.id AND status = 'pending';

    INSERT INTO nova.audit_events (
      organisation_id, actor_person_id, action, target_type, target_id, details
    ) VALUES (
      item.organisation_id, NULL, 'tasks.handover_request_expired',
      'task_handover_request', item.id,
      jsonb_build_object('assignment_id', item.assignment_id)
    );

    INSERT INTO nova.notifications (
      organisation_id, recipient_person_id, event_key, title, body,
      aggregate_type, aggregate_id, deep_link, idempotency_key
    ) VALUES (
      item.organisation_id, item.requester_person_id, 'task.handover_request_expired',
      'Handover request expired', 'Your handover request expired. Choose another person.',
      'task_handover_request', item.id, '/?view=work&assignment=' || item.assignment_id,
      'task.handover_request_expired:' || item.id
    ) ON CONFLICT (recipient_person_id, idempotency_key) DO NOTHING;

    expired_count := expired_count + 1;
  END LOOP;

  RETURN expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION nova.reconcile_unavailable_reviewers(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  item record;
  changed_count integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REVIEWER_RECONCILIATION_INPUT_INVALID';
  END IF;

  FOR item IN
    SELECT assignments.id, assignments.organisation_id, assignments.person_id,
           assignments.reviewer_person_id, tasks.id AS task_id, tasks.title
    FROM nova.task_assignments assignments
    JOIN nova.tasks tasks ON tasks.id = assignments.task_id
    WHERE assignments.status = 'awaiting_review'
      AND assignments.reviewer_person_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM nova.person_status_periods statuses
        WHERE statuses.person_id = assignments.reviewer_person_id
          AND statuses.ended_at IS NULL
          AND statuses.status IN ('active', 'notice')
      )
    ORDER BY assignments.updated_at NULLS FIRST
    LIMIT p_limit
    FOR UPDATE OF assignments SKIP LOCKED
  LOOP
    UPDATE nova.task_assignments
    SET reviewer_person_id = NULL,
        review_blocked_reason = 'REVIEWER_UNAVAILABLE',
        review_blocked_at = clock_timestamp()
    WHERE id = item.id AND status = 'awaiting_review' AND reviewer_person_id = item.reviewer_person_id;

    IF FOUND THEN
      UPDATE nova.task_review_cycles
      SET reviewer_person_id = NULL
      WHERE assignment_id = item.id AND decided_at IS NULL;

      INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES (
        item.organisation_id, NULL, 'tasks.reviewer_unavailable',
        'task_assignment', item.id,
        jsonb_build_object('previous_reviewer_person_id', item.reviewer_person_id)
      );

      INSERT INTO nova.notifications (
        organisation_id, recipient_person_id, event_key, title, body,
        aggregate_type, aggregate_id, deep_link, idempotency_key
      ) VALUES (
        item.organisation_id, item.person_id, 'task.reviewer_unavailable',
        'Reviewer unavailable', 'Your submitted work needs a new reviewer.',
        'task_assignment', item.id, '/?view=work&task=' || item.task_id,
        'task.reviewer_unavailable:' || item.id || ':' || item.reviewer_person_id
      ) ON CONFLICT (recipient_person_id, idempotency_key) DO NOTHING;

      changed_count := changed_count + 1;
    END IF;
  END LOOP;

  RETURN changed_count;
END;
$$;

CREATE OR REPLACE FUNCTION nova.close_person_attendance(
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
  UPDATE nova.attendance_days attendance
  SET checked_out_at = GREATEST(
        LEAST(
          p_effective_at,
          ((attendance.business_date + 1)::timestamp AT TIME ZONE offices.timezone)
        ),
        attendance.checked_in_at + interval '1 microsecond'
      ),
      closure_reason = 'LIFECYCLE_CHANGE'
  FROM nova.offices offices
  WHERE attendance.office_id = offices.id
    AND attendance.person_id = p_person_id
    AND attendance.checked_out_at IS NULL
    AND attendance.checked_in_at <= p_effective_at;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

CREATE OR REPLACE FUNCTION nova.close_person_work_sessions(
  p_person_id uuid,
  p_ended_at timestamptz,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  UPDATE nova.work_sessions sessions
  SET ended_at = GREATEST(
        CASE WHEN sessions.office_id IS NULL THEN p_ended_at
          ELSE LEAST(
            p_ended_at,
            (((sessions.started_at AT TIME ZONE (SELECT timezone FROM nova.offices WHERE id = sessions.office_id))::date + 1)::timestamp
              AT TIME ZONE (SELECT timezone FROM nova.offices WHERE id = sessions.office_id))
          )
        END,
        sessions.started_at + interval '1 microsecond'
      ),
      state = 'auto_closed',
      closure_reason = left(COALESCE(p_reason, 'LIFECYCLE_CHANGE'), 120)
  WHERE sessions.person_id = p_person_id AND sessions.ended_at IS NULL;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

CREATE OR REPLACE FUNCTION nova.close_assignment_work_sessions(
  p_assignment_id uuid,
  p_effective_at timestamptz,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  closed_count integer;
BEGIN
  UPDATE nova.work_sessions sessions
  SET ended_at = GREATEST(
        CASE WHEN sessions.office_id IS NULL THEN p_effective_at
          ELSE LEAST(
            p_effective_at,
            (((sessions.started_at AT TIME ZONE (SELECT timezone FROM nova.offices WHERE id = sessions.office_id))::date + 1)::timestamp
              AT TIME ZONE (SELECT timezone FROM nova.offices WHERE id = sessions.office_id))
          )
        END,
        sessions.started_at + interval '1 microsecond'
      ),
      state = 'auto_closed',
      closure_reason = left(COALESCE(p_reason, 'LIFECYCLE_CHANGE'), 120)
  WHERE sessions.assignment_id = p_assignment_id
    AND sessions.ended_at IS NULL;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

REVOKE ALL ON FUNCTION nova.expire_task_requests(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.reconcile_unavailable_reviewers(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.purge_expired_api_idempotency_keys(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.is_valid_timezone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.close_person_attendance(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.close_person_work_sessions(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nova.close_assignment_work_sessions(uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nova.expire_task_requests(integer) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.reconcile_unavailable_reviewers(integer) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.purge_expired_api_idempotency_keys(integer) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.is_valid_timezone(text) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.close_person_attendance(uuid, timestamptz) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.close_person_work_sessions(uuid, timestamptz, text) TO nova_app;
GRANT EXECUTE ON FUNCTION nova.close_assignment_work_sessions(uuid, timestamptz, text) TO nova_app;
