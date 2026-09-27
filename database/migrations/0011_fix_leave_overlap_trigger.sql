-- Repair 0010 for deployments that applied it before the generic trigger
-- record branch was split. Keep the canonical source in 0010 fixed as well.

CREATE OR REPLACE FUNCTION nova.validate_leave_request_overlap()
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
