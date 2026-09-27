-- Make permission/scope compatibility canonical in PostgreSQL. The API uses
-- the same catalogue when rendering and validating custom roles.

ALTER TABLE nova.permissions
  ADD COLUMN allowed_scopes nova.permission_scope[] NOT NULL
    DEFAULT ARRAY['organisation'::nova.permission_scope];

UPDATE nova.permissions AS permissions
SET allowed_scopes = mapping.allowed_scopes
FROM (VALUES
  ('people.view', ARRAY['organisation','office','organisation_department']::nova.permission_scope[]),
  ('people.edit', ARRAY['organisation','office','organisation_department']::nova.permission_scope[]),
  ('people.freeze', ARRAY['organisation','office','organisation_department']::nova.permission_scope[]),
  ('people.offboard', ARRAY['organisation','office','organisation_department']::nova.permission_scope[]),
  ('clients.view', ARRAY['organisation','client']::nova.permission_scope[]),
  ('clients.edit', ARRAY['organisation','client']::nova.permission_scope[]),
  ('tasks.view', ARRAY['organisation','client','client_workstream','group','assigned_work']::nova.permission_scope[]),
  ('tasks.edit', ARRAY['organisation','client','client_workstream','group','assigned_work']::nova.permission_scope[]),
  ('tasks.assign', ARRAY['organisation','client','client_workstream','group']::nova.permission_scope[]),
  ('tasks.reassign', ARRAY['organisation','client','client_workstream','group']::nova.permission_scope[]),
  ('tasks.start', ARRAY['organisation','assigned_work']::nova.permission_scope[]),
  ('tasks.submit', ARRAY['organisation','assigned_work']::nova.permission_scope[]),
  ('tasks.review', ARRAY['organisation','assigned_work']::nova.permission_scope[]),
  ('attendance.view', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('attendance.check_in', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('attendance.check_out', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('attendance.recover', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('attendance.change_mode', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('work.timeline.view', ARRAY['organisation','office','organisation_department','client','client_workstream','group','assigned_work']::nova.permission_scope[]),
  ('work.timeline_adjust_own', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('work.timeline_adjust_others', ARRAY['organisation','office','organisation_department','client','client_workstream','group','assigned_work']::nova.permission_scope[]),
  ('leave.request', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('leave.review', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('availability.wfh.request', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('availability.wfh.review', ARRAY['organisation','own_record','office','organisation_department']::nova.permission_scope[]),
  ('notifications.manage', ARRAY['organisation']::nova.permission_scope[]),
  ('notifications.delivery.view', ARRAY['organisation']::nova.permission_scope[])
) AS mapping(key, allowed_scopes)
WHERE mapping.key = permissions.key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM nova.role_permission_grants grants
    JOIN nova.permissions permissions ON permissions.key = grants.permission_key
    WHERE NOT (grants.scope = ANY(permissions.allowed_scopes))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'EXISTING_PERMISSION_SCOPE_NOT_ALLOWED';
  END IF;
END;
$$;

CREATE FUNCTION nova.validate_permission_scope_catalogue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean;
BEGIN
  SELECT NEW.scope = ANY(permissions.allowed_scopes)
  INTO allowed
  FROM nova.permissions permissions
  WHERE permissions.key = NEW.permission_key;
  IF COALESCE(allowed, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PERMISSION_SCOPE_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permission_grants_validate_scope_catalogue
BEFORE INSERT OR UPDATE ON nova.role_permission_grants
FOR EACH ROW EXECUTE FUNCTION nova.validate_permission_scope_catalogue();
