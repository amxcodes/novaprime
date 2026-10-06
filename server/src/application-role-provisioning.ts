function sqlLiteral(value: string): string {
  if (value.includes("\0")) {
    throw new Error("NOVA_APP_PASSWORD_INVALID");
  }

  return `'${value.replaceAll("'", "''")}'`;
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

GRANT USAGE ON SCHEMA nova TO nova_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova TO nova_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA nova
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nova_app;
`;
}
