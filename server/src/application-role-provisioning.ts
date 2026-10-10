function sqlLiteral(value: string): string {
  if (value.includes("\0")) {
    throw new Error("NOVA_APP_PASSWORD_INVALID");
  }

  return `'${value.replaceAll("'", "''")}'`;
}

const validApplicationRoleName = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Grant ordinary application-table access, then restore the maintenance lease
 * table's function-only boundary after the broad schema grant. The table
 * check keeps this safe when the helper runs before migration 0080.
 */
export function applicationRoleTableGrantsSql(applicationRoleName: string): string {
  if (!validApplicationRoleName.test(applicationRoleName)) {
    throw new Error("APPLICATION_DATABASE_ROLE_INVALID");
  }
  // Role names are restricted to a safe lowercase PostgreSQL identifier, so
  // emitting the same spelling without quotes also preserves existing setup
  // output and cannot change its identifier meaning.
  const role = applicationRoleName;
  return `
GRANT USAGE ON SCHEMA nova TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA nova
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
DO $nova_background_lease_acl$
BEGIN
  IF to_regclass('nova.background_tick_lease') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE nova.background_tick_lease FROM ${role}';
  END IF;
END;
$nova_background_lease_acl$;
`;
}

/**
 * Create NOVA's restricted app role when absent. Existing credentials stay
 * stable unless the operator explicitly requests a coordinated rotation.
 */
export function applicationRoleProvisioningSql(
  applicationPassword: string,
  options: { rotateExistingPassword?: boolean } = {},
): string {
  const password = sqlLiteral(applicationPassword);
  const existingRoleAction = options.rotateExistingPassword
    ? `ELSE
    ALTER ROLE nova_app LOGIN PASSWORD ${password};`
    : "";

  return `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nova_app') THEN
    CREATE ROLE nova_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
      PASSWORD ${password};
  ${existingRoleAction}
  END IF;
END;
$$;

${applicationRoleTableGrantsSql("nova_app")}
`;
}
