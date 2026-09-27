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

export function configuredSupabasePoolerHost(input: Readonly<{
  projectRef: string;
  explicitHost?: string;
  environmentProjectRef?: string;
  environmentHost?: string;
  savedProjectRef?: string;
  savedHost?: string;
}>): string | undefined {
  const savedProjectMatches = !input.savedProjectRef || input.savedProjectRef === input.projectRef;
  const configured = input.explicitHost ??
    (savedProjectMatches && input.environmentProjectRef === input.projectRef ? input.environmentHost : undefined) ??
    (input.savedProjectRef === input.projectRef ? input.savedHost : undefined);
  return configured ? validateSupabasePoolerHost(configured) : undefined;
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
