import { databaseIdentityFingerprint } from "../../server/src/deployment-identity.ts";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVerifiedReleaseTreeFromRoot } from "../update/release.ts";

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
  migrationInventory: {
    state: "current" | "behind" | "ahead" | "diverged" | "unverified" | "not-installed" | "target-required" | "unavailable";
    appliedCount: number | null;
    migrationHead: string | null;
    expectedHead: string | null;
    checksumsVerified: boolean;
    detail?: string;
  };
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
  migrationInventory?: SupabaseCronInventory["migrationInventory"];
}

interface ExpectedMigration {
  filename: string;
  sha256: string;
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

async function readMigrationInventory(
  client: QueryClient,
  expectedMigrations: readonly ExpectedMigration[] | undefined,
): Promise<SupabaseCronInventory["migrationInventory"]> {
  const expectedHead = expectedMigrations?.at(-1)?.filename ?? null;
  const ledger = await client.query<{ available: boolean }>(
    "SELECT to_regclass('public.nova_schema_migrations') IS NOT NULL AS available",
  );
  if (ledger.rows[0]?.available !== true) {
    return { state: "not-installed", appliedCount: 0, migrationHead: null, expectedHead, checksumsVerified: false };
  }
  const checksumColumn = await client.query<{ available: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations' AND column_name = 'sha256'
     ) AS available`,
  );
  const hasChecksums = checksumColumn.rows[0]?.available === true;
  const result = await client.query<{ filename: string; sha256: string | null }>(
    hasChecksums
      ? "SELECT filename, sha256 FROM public.nova_schema_migrations ORDER BY filename"
      : "SELECT filename, NULL::text AS sha256 FROM public.nova_schema_migrations ORDER BY filename",
  );
  if (result.rows.length > 10_000) throw new Error("MIGRATION_INVENTORY_RESPONSE_INVALID");
  const applied = result.rows.map(({ filename, sha256 }) => {
    if (typeof filename !== "string" || !/^\d{4}_[a-z0-9_]+\.sql$/.test(filename) ||
        (sha256 !== null && (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256)))) {
      throw new Error("MIGRATION_INVENTORY_RESPONSE_INVALID");
    }
    return { filename, sha256: sha256?.toLowerCase() ?? null };
  });
  if (new Set(applied.map(({ filename }) => filename)).size !== applied.length) {
    throw new Error("MIGRATION_INVENTORY_RESPONSE_INVALID");
  }
  const migrationHead = applied.at(-1)?.filename ?? null;
  if (!expectedMigrations) {
    return {
      state: "unverified", appliedCount: applied.length, migrationHead, expectedHead,
      checksumsVerified: false, detail: "LOCAL_MIGRATION_MANIFEST_INVALID",
    };
  }
  const expectedByFilename = new Map(expectedMigrations.map((item) => [item.filename, item.sha256]));
  if (applied.some(({ filename }) => !expectedByFilename.has(filename))) {
    return { state: "ahead", appliedCount: applied.length, migrationHead, expectedHead, checksumsVerified: false };
  }
  if (applied.some(({ filename }, index) => expectedMigrations[index]?.filename !== filename)) {
    return { state: "diverged", appliedCount: applied.length, migrationHead, expectedHead, checksumsVerified: false };
  }
  if (applied.some(({ filename, sha256 }) => sha256 !== null && sha256 !== expectedByFilename.get(filename))) {
    return { state: "diverged", appliedCount: applied.length, migrationHead, expectedHead, checksumsVerified: false, detail: "MIGRATION_CHECKSUM_MISMATCH" };
  }
  const checksumsVerified = applied.length === 0 || (hasChecksums && applied.every(({ sha256 }) => sha256 !== null));
  if (!checksumsVerified) {
    return { state: "unverified", appliedCount: applied.length, migrationHead, expectedHead, checksumsVerified: false, detail: "DATABASE_MIGRATION_CHECKSUMS_NOT_AVAILABLE" };
  }
  return {
    state: applied.length === expectedMigrations.length ? "current" : "behind",
    appliedCount: applied.length,
    migrationHead,
    expectedHead,
    checksumsVerified: true,
  };
}

async function readTriggers(
  client: QueryClient,
  expectedMigrations: readonly ExpectedMigration[] | undefined,
): Promise<TriggerReadResult> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const relation = await client.query<{ available: boolean }>(
      "SELECT to_regclass('cron.job') IS NOT NULL AS available",
    );
    let installed = relation.rows[0]?.available === true;
    let triggers: SupabaseCronTrigger[] = [];
    if (installed) {
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
      triggers = result.rows.map((row) => {
        if (!/^\d{1,20}$/.test(row.id) || typeof row.name !== "string" ||
            !/^[A-Za-z0-9_.:-]{1,120}$/.test(row.name) || typeof row.schedule !== "string" ||
            row.schedule.length > 120 || typeof row.active !== "boolean") {
          throw new Error("SCHEDULER_INVENTORY_RESPONSE_INVALID");
        }
        return { id: row.id, name: row.name, schedule: row.schedule, active: row.active };
      });
    }
    const migrationInventory = await readMigrationInventory(client, expectedMigrations);
    await client.query("COMMIT");
    return { installed, triggers, migrationInventory };
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
  if (error instanceof Error && error.message === "MIGRATION_INVENTORY_RESPONSE_INVALID") return error.message;
  if (code === "42501") return "MIGRATOR_PERMISSION_DENIED";
  return "SCHEDULER_READ_FAILED";
}

/** Read only NOVA-owned Supabase Cron rows using the explicitly selected migration-owner URL. */
export async function inspectSupabaseCronInventory(
  environment: Readonly<Record<string, string>>,
  dependencies: {
    connect?: (connectionString: string) => Promise<DatabasePool>;
    read?: (client: QueryClient, expectedMigrations: readonly ExpectedMigration[] | undefined) => Promise<TriggerReadResult>;
    expectedMigrations?: readonly ExpectedMigration[];
  } = {},
): Promise<SupabaseCronInventory> {
  const connectionString = environment.MIGRATOR_DATABASE_URL;
  if (!connectionString) {
    return {
      state: "target-required",
      completeness: "not-inspected",
      triggers: [],
      migrationInventory: {
        state: "target-required", appliedCount: null, migrationHead: null, expectedHead: null,
        checksumsVerified: false, detail: "MIGRATOR_DATABASE_URL_REQUIRED_FOR_MIGRATION_INVENTORY",
      },
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
      migrationInventory: {
        state: "unavailable", appliedCount: null, migrationHead: null, expectedHead: null,
        checksumsVerified: false, detail: "MIGRATOR_DATABASE_TARGET_MISMATCH",
      },
      detail: "MIGRATOR_DATABASE_TARGET_MISMATCH",
    };
  }

  let pool: DatabasePool | undefined;
  let expectedMigrations = dependencies.expectedMigrations;
  try {
    if (!expectedMigrations && !dependencies.read) {
      try {
        const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
        expectedMigrations = (await loadVerifiedReleaseTreeFromRoot(root)).manifest.migrations;
      } catch { /* Keep DB facts but make their comparison explicitly unverified. */ }
    }
    pool = await (dependencies.connect ?? connectDatabase)(connectionString);
    const client = await pool.connect();
    try {
      const result = await (dependencies.read ?? readTriggers)(client, expectedMigrations);
      return {
        state: result.installed ? "verified" : "not-installed",
        completeness: "project-scoped",
        triggers: result.triggers,
        migrationInventory: result.migrationInventory ?? {
          state: "unverified", appliedCount: null, migrationHead: null,
          expectedHead: expectedMigrations?.at(-1)?.filename ?? null,
          checksumsVerified: false, detail: "MIGRATION_INVENTORY_NOT_RETURNED",
        },
      };
    } finally {
      client.release?.();
    }
  } catch (error) {
    return {
      state: "unavailable",
      completeness: "not-inspected",
      triggers: [],
      migrationInventory: {
        state: "unavailable", appliedCount: null, migrationHead: null,
        expectedHead: expectedMigrations?.at(-1)?.filename ?? null,
        checksumsVerified: false, detail: connectionErrorCode(error),
      },
      detail: connectionErrorCode(error),
    };
  } finally {
    await pool?.end().catch(() => undefined);
  }
}
