type PoolerConfiguration = Readonly<{
  database_type?: unknown;
  pool_mode?: unknown;
  db_host?: unknown;
  db_port?: unknown;
  db_name?: unknown;
  connection_string?: unknown;
  connectionString?: unknown;
}>;

const poolerHostPattern = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;

export function validateSupabasePoolerHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!poolerHostPattern.test(host)) throw new Error("SUPABASE_POOLER_HOST_INVALID");
  return host;
}

/**
 * Fail closed when an operator-selected Supabase project and the runtime
 * connection string identify different databases. Pooler URLs bind the
 * project in the role suffix; direct URLs bind it in the database hostname.
 */
export function assertSupabaseDatabaseUrlBinding(
  databaseUrl: string,
  projectRef: string,
  applicationRole = "nova_app",
): void {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(applicationRole)) {
    throw new Error("NOVA_APPLICATION_DATABASE_ROLE_INVALID");
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("SUPABASE_DATABASE_URL_PROJECT_UNVERIFIABLE");
  }
  if (!/^(postgres|postgresql):$/.test(url.protocol)) {
    throw new Error("SUPABASE_DATABASE_URL_PROJECT_UNVERIFIABLE");
  }

  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error("SUPABASE_DATABASE_URL_PROJECT_UNVERIFIABLE");
  }

  const roleParts = username.split(".");
  const roleMatches = roleParts[0] === applicationRole;
  const pooler = poolerHostPattern.test(url.hostname.toLowerCase());
  if (pooler) {
    if (!roleMatches || roleParts.length !== 2 || roleParts[1] !== projectRef) {
      throw new Error("SUPABASE_DATABASE_URL_PROJECT_MISMATCH");
    }
    return;
  }

  const directProject = url.hostname.toLowerCase().match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!directProject) {
    throw new Error("SUPABASE_DATABASE_URL_PROJECT_UNVERIFIABLE");
  }
  if (
    directProject !== projectRef || !roleMatches ||
    (roleParts.length > 1 && (roleParts.length !== 2 || roleParts[1] !== projectRef))
  ) {
    throw new Error("SUPABASE_DATABASE_URL_PROJECT_MISMATCH");
  }
}

function projectRefFromDatabaseUrl(databaseUrl: string): string | undefined {
  try {
    const url = new URL(databaseUrl);
    if (!/^(postgres|postgresql):$/.test(url.protocol)) return undefined;

    const pooler = poolerHostPattern.test(url.hostname.toLowerCase());
    if (pooler) {
      const roleParts = decodeURIComponent(url.username).split(".");
      return roleParts.length === 2 && /^[a-z0-9]{20}$/.test(roleParts[1])
        ? roleParts[1]
        : undefined;
    }

    return url.hostname.toLowerCase().match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * A saved app-role password belongs to the Supabase project that provisioned
 * it. Don't silently carry it to another project's existing nova_app role.
 */
export function assertSupabaseAppPasswordProjectBinding(input: Readonly<{
  projectRef: string;
  previousProjectRef?: string;
  previousDatabaseUrl?: string;
  rotateExistingPassword: boolean;
}>): void {
  const previousUrlProjectRef = input.previousDatabaseUrl
    ? projectRefFromDatabaseUrl(input.previousDatabaseUrl)
    : undefined;
  const projectChanged =
    (input.previousProjectRef !== undefined && input.previousProjectRef !== input.projectRef) ||
    (previousUrlProjectRef !== undefined && previousUrlProjectRef !== input.projectRef);

  if (projectChanged && !input.rotateExistingPassword) {
    throw new Error("NOVA_APP_PASSWORD_PROJECT_SWITCH_REQUIRES_ROTATION_FLAG");
  }
}

export function selectSupabasePoolerHost(input: Readonly<{
  verifiedHost: string;
  explicitHost?: string;
}>): string {
  const verifiedHost = validateSupabasePoolerHost(input.verifiedHost);
  if (input.explicitHost && validateSupabasePoolerHost(input.explicitHost) !== verifiedHost) {
    throw new Error("SUPABASE_POOLER_HOST_PROJECT_MISMATCH");
  }
  return verifiedHost;
}

function connectionDetails(configuration: PoolerConfiguration): { host: string; port: number } | undefined {
  const connectionString = configuration.connection_string ?? configuration.connectionString;
  if (typeof connectionString === "string" && connectionString.trim()) {
    try {
      const url = new URL(connectionString);
      const host = validateSupabasePoolerHost(url.hostname);
      const port = Number(url.port || 5432);
      if (!/^(postgres|postgresql):$/.test(url.protocol) || port !== 6543 || url.pathname !== "/postgres") {
        return undefined;
      }
      if (typeof configuration.db_host === "string" && configuration.db_host.toLowerCase() !== host) {
        return undefined;
      }
      if (typeof configuration.db_port === "number" && configuration.db_port !== port) return undefined;
      if (typeof configuration.db_name === "string" && configuration.db_name !== "postgres") return undefined;
      return { host, port };
    } catch {
      return undefined;
    }
  }

  if (typeof configuration.db_host !== "string" || configuration.db_port !== 6543 || configuration.db_name !== "postgres") {
    return undefined;
  }
  try {
    return { host: validateSupabasePoolerHost(configuration.db_host), port: 6543 };
  } catch {
    return undefined;
  }
}

export function supabasePoolerHostFromConfiguration(value: unknown): string {
  if (!Array.isArray(value)) throw new Error("SUPABASE_POOLER_CONFIGURATION_INVALID");
  const configs = value as PoolerConfiguration[];
  const primaryTransactionPooler = configs.find((config) =>
    config.database_type === "PRIMARY" && config.pool_mode === "transaction" && connectionDetails(config),
  );
  const connection = primaryTransactionPooler && connectionDetails(primaryTransactionPooler);
  if (!connection) throw new Error("SUPABASE_TRANSACTION_POOLER_NOT_FOUND");
  return connection.host;
}

export async function resolveSupabasePoolerHost(
  projectRef: string,
  accessToken: string,
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  if (!accessToken.trim()) throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED");
  const response = await request(`https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SUPABASE_POOLER_CONFIG_LOOKUP_FAILED_${response.status}`);
  return supabasePoolerHostFromConfiguration(await response.json());
}
