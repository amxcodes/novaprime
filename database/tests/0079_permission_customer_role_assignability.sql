-- Future permissions must be hidden from customer-role assignment while
-- existing/protected grants remain representable. The fixture is rolled back.
BEGIN;

-- New catalogue entries default to unavailable until a migration explicitly
-- promotes a shipped permission to customer-role assignment.
INSERT INTO nova.permissions (key, module, description)
VALUES ('future.test_permission', 'future', 'Reserved permission for an unimplemented feature.');

GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA customer role permission catalogue test',
  'customer-role-catalogue@example.test',
  'Customer Role Catalogue Test',
  'better-auth-subject-customer-role-catalogue'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_super_admin_role_id uuid;
  v_custom_role_id uuid;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-customer-role-catalogue');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM nova.permissions
    WHERE key = 'people.view' AND customer_role_assignable
  ) THEN
    RAISE EXCEPTION 'implemented permission is not customer-role assignable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM nova.permissions
    WHERE key LIKE 'payroll.%' AND customer_role_assignable
  ) THEN
    RAISE EXCEPTION 'future payroll permission is customer-role assignable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nova.permissions
    WHERE key LIKE 'payroll.%'
  ) THEN
    RAISE EXCEPTION 'payroll catalogue permissions were deleted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nova.permissions
    WHERE key = 'future.test_permission' AND NOT customer_role_assignable
  ) THEN
    RAISE EXCEPTION 'new permission did not default to unavailable';
  END IF;

  SELECT id INTO v_super_admin_role_id
  FROM nova.roles
  WHERE organisation_id = v_organisation_id AND key = 'super_admin';
  IF NOT EXISTS (
    SELECT 1 FROM nova.role_permission_grants grants
    WHERE grants.role_id = v_super_admin_role_id
      AND grants.permission_key = 'payroll.view'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'future grant was removed from the protected bootstrap role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nova.role_permission_grants grants
    WHERE grants.role_id = v_super_admin_role_id
      AND grants.permission_key = 'future.test_permission'
      AND grants.scope = 'organisation'
  ) THEN
    RAISE EXCEPTION 'future grant was not retained for the protected bootstrap role';
  END IF;

  INSERT INTO nova.roles (organisation_id, key, name)
  VALUES (v_organisation_id, 'legacy_future_access', 'Legacy Future Access')
  RETURNING id INTO v_custom_role_id;
  INSERT INTO nova.role_operational_policies (role_id) VALUES (v_custom_role_id);
  INSERT INTO nova.role_permission_grants (role_id, permission_key, scope)
  VALUES (v_custom_role_id, 'payroll.view', 'organisation');
  IF NOT EXISTS (
    SELECT 1 FROM nova.role_permission_grants
    WHERE role_id = v_custom_role_id AND permission_key = 'payroll.view'
  ) THEN
    RAISE EXCEPTION 'legacy future grant cannot be preserved';
  END IF;
END;
$$;

ROLLBACK;
