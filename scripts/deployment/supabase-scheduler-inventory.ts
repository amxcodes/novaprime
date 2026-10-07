import { databaseIdentityFingerprint } from "../../server/src/deployment-identity.ts";
import { createRequire } from "node:module";

const requireServerDependency = createRequire(new URL("../../server/package.json", import.meta.url));

export interface SupabaseCronTrigger {
  id: string;
  name: string;
  schedule: string;
  active: boolean;
}

export interface SupabaseCronInventory {
  state: "verified" | "not-installed" | "target-required" | "unavailable";
  completeness: "project-scoped" | "not-inspected";
  triggers: SupabaseCronTrigger[];
  detail?: string;
}

interface QueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  release?(): void;
}

interface TriggerReadResult {
  installed: boolean;
  triggers: SupabaseCronTrigger[];
}

interface DatabasePool {
  connect(): Promise<QueryClient>;
  end(): Promise<void>;
}

async function connectDatabase(connectionString: string): Promise<DatabasePool> {
  const postgres = requireServerDependency("pg") as {
    Pool: new (options: {
      connectionString: string;
      max: number;
      connectionTimeoutMillis: number;
      idleTimeoutMillis: number;
      statement_timeout: number;
      application_name: string;
    }) => DatabasePool;
  };
  return new postgres.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    statement_timeout: 5_000,
    application_name: "nova-deployment-inventory",
  });
}

async function readTriggers(client: QueryClient): Promise<TriggerReadResult> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const relation = await client.query<{ available: boolean }>(
      "SELECT to_regclass('cron.job') IS NOT NULL AS available",
    );
    if (relation.rows[0]?.available !== true) {
      await client.query("COMMIT");
      return { installed: false, triggers: [] };
    }
    const result = await client.query<{
      id: string;
      name: string;
      schedule: string;
      active: boolean;
    }>(
      `SELECT jobid::text AS id, jobname AS name, schedule, active
       FROM cron.job
       WHERE jobname = $1 OR command ILIKE $2
       ORDER BY jobid`,
      ["nova-background-tick", "%/api/internal/background/tick%"],
    );
    const triggers = result.rows.map((row) => {
      if (!/^\d{1,20}$/.test(row.id) || typeof row.name !== "string" ||
          !/^[A-Za-z0-9_.:-]{1,120}$/.test(row.name) || typeof row.schedule !== "string" ||
          row.schedule.length > 120 || typeof row.active !== "boolean") {
        throw new Error("SCHEDULER_INVENTORY_RESPONSE_INVALID");
      }
      return { id: row.id, name: row.name, schedule: row.schedule, active: row.active };
    });
    await client.query("COMMIT");
    return { installed: true, triggers };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function connectionErrorCode(error: unknown): string {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") return "DATABASE_DRIVER_UNAVAILABLE";
  if (code === "28P01") return "MIGRATOR_CREDENTIAL_REJECTED";
  if (code === "3D000") return "DATABASE_NOT_FOUND";
  if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ECONNRESET") {
    return "DATABASE_UNREACHABLE";
  }
  if (error instanceof Error && error.message === "SCHEDULER_INVENTORY_RESPONSE_INVALID") return error.message;
  return "SCHEDULER_READ_FAILED";
}

/** Read only NOVA-owned Supabase Cron rows using the explicitly selected migration-owner URL. */
export async function inspectSupabaseCronInventory(
  environment: Readonly<Record<string, string>>,
  dependencies: {
    connect?: (connectionString: string) => Promise<DatabasePool>;
    read?: (client: QueryClient) => Promise<TriggerReadResult>;
  } = {},
): Promise<SupabaseCronInventory> {
  const connectionString = environment.MIGRATOR_DATABASE_URL;
  if (!connectionString) {
    return {
      state: "target-required",
      completeness: "not-inspected",
      triggers: [],
      detail: "MIGRATOR_DATABASE_URL_REQUIRED_FOR_READ_ONLY_CRON_INVENTORY",
    };
  }
  const databaseUrl = environment.DATABASE_URL;
  const configuredRef = environment.NOVA_SUPABASE_PROJECT_REF;
  const ownerFingerprint = databaseIdentityFingerprint(connectionString, configuredRef);
  const appFingerprint = databaseUrl ? databaseIdentityFingerprint(databaseUrl, configuredRef) : null;
  if (!ownerFingerprint || !appFingerprint || ownerFingerprint !== appFingerprint) {
    return {
      state: "unavailable",
      completeness: "not-inspected",
      triggers: [],
      detail: "MIGRATOR_DATABASE_TARGET_MISMATCH",
    };
  }

  let pool: DatabasePool | undefined;
  try {
    pool = await (dependencies.connect ?? connectDatabase)(connectionString);
    const client = await pool.connect();
    try {
      const result = await (dependencies.read ?? readTriggers)(client);
      return {
        state: result.installed ? "verified" : "not-installed",
        completeness: "project-scoped",
        triggers: result.triggers,
      };
    } finally {
      client.release?.();
    }
  } catch (error) {
    return {
      state: "unavailable",
      completeness: "not-inspected",
      triggers: [],
      detail: connectionErrorCode(error),
    };
  } finally {
    await pool?.end().catch(() => undefined);
  }
}
