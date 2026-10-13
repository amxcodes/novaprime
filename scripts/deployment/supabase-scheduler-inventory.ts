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
  deliveryEvidence: SupabaseSchedulerDeliveryEvidence;
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

export interface SupabaseSchedulerDeliveryEvidence {
  state: "verified" | "unverified" | "not-installed" | "unavailable";
  recentRunCount: number;
  recentRunSuccessCount: number;
  latestRunFresh: boolean;
  latestHttpStatusCode: number | null;
  latestHttpTimedOut: boolean | null;
  latestHttpErrorPresent: boolean | null;
  httpResponseMatchesLatestRun: boolean;
  callbackOriginMatchesConfigured: boolean | null;
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
  deliveryEvidence?: SupabaseSchedulerDeliveryEvidence;
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
  configuredOrigin: string | undefined,
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
    const deliveryEvidence = await readSchedulerDeliveryEvidence(client, triggers, configuredOrigin);
    const migrationInventory = await readMigrationInventory(client, expectedMigrations);
    await client.query("COMMIT");
    return { installed, triggers, deliveryEvidence, migrationInventory };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function validHttpsOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function deliveryEvidence(
  state: SupabaseSchedulerDeliveryEvidence["state"],
  detail: string,
  values: Partial<Omit<SupabaseSchedulerDeliveryEvidence, "state" | "detail">> = {},
): SupabaseSchedulerDeliveryEvidence {
  return {
    state,
    recentRunCount: values.recentRunCount ?? 0,
    recentRunSuccessCount: values.recentRunSuccessCount ?? 0,
    latestRunFresh: values.latestRunFresh ?? false,
    latestHttpStatusCode: values.latestHttpStatusCode ?? null,
    latestHttpTimedOut: values.latestHttpTimedOut ?? null,
    latestHttpErrorPresent: values.latestHttpErrorPresent ?? null,
    httpResponseMatchesLatestRun: values.httpResponseMatchesLatestRun ?? false,
    callbackOriginMatchesConfigured: values.callbackOriginMatchesConfigured ?? null,
    detail,
  };
}

async function readSchedulerDeliveryEvidence(
  client: QueryClient,
  triggers: readonly SupabaseCronTrigger[],
  configuredOrigin: string | undefined,
): Promise<SupabaseSchedulerDeliveryEvidence> {
  const activeTriggers = triggers.filter(({ active }) => active);
  if (activeTriggers.length === 0) return deliveryEvidence("not-installed", "SUPABASE_NOVA_CRON_NOT_ACTIVE");
  if (activeTriggers.length !== 1 || activeTriggers[0]?.name !== "nova-background-tick" ||
      activeTriggers[0]?.schedule !== "*/5 * * * *") {
    return deliveryEvidence("unverified", "SUPABASE_NOVA_CRON_NOT_EXACTLY_ONE_EXPECTED_TICK");
  }
  const origin = validHttpsOrigin(configuredOrigin);
  if (!origin) return deliveryEvidence("unverified", "NOVA_PUBLIC_ORIGIN_MUST_BE_CONFIGURED_AS_HTTPS_ORIGIN");

  const relations = await client.query<{
    cronHistoryAvailable: boolean;
    httpHistoryAvailable: boolean;
    vaultAvailable: boolean;
  }>(`SELECT
       to_regclass('cron.job_run_details') IS NOT NULL AS "cronHistoryAvailable",
       to_regclass('net._http_response') IS NOT NULL AS "httpHistoryAvailable",
       to_regclass('vault.decrypted_secrets') IS NOT NULL AS "vaultAvailable"`);
  const available = relations.rows[0];
  if (!available || !available.cronHistoryAvailable || !available.httpHistoryAvailable || !available.vaultAvailable) {
    return deliveryEvidence("unverified", "SUPABASE_CRON_VAULT_OR_DELIVERY_HISTORY_UNAVAILABLE");
  }

  const vault = await client.query<{
    urlSecretPresent: boolean;
    jobSecretPresent: boolean;
    callbackMatchesOrigin: boolean;
  }>(`SELECT
       count(*) FILTER (WHERE name = 'nova_background_url') = 1 AS "urlSecretPresent",
       count(*) FILTER (WHERE name = 'nova_background_job_secret') = 1 AS "jobSecretPresent",
       coalesce(bool_or(
         name = 'nova_background_url' AND
         lower(trim(trailing '/' FROM decrypted_secret)) = lower($1)
       ), false) AS "callbackMatchesOrigin"
     FROM vault.decrypted_secrets
     WHERE name IN ('nova_background_url', 'nova_background_job_secret')`, [origin]);
  const vaultEvidence = vault.rows[0];
  if (!vaultEvidence) throw new Error("SCHEDULER_DELIVERY_INVENTORY_RESPONSE_INVALID");

  const recent = await client.query<{
    recentRunCount: number;
    recentRunSuccessCount: number;
    latestRunFresh: boolean;
    latestHttpStatusCode: number | null;
    latestHttpTimedOut: boolean | null;
    latestHttpErrorPresent: boolean | null;
    httpResponseMatchesLatestRun: boolean;
  }>(`WITH target_job AS (
       SELECT jobid FROM cron.job WHERE jobname = 'nova-background-tick' AND active
     ), recent_runs AS (
       SELECT jobid, status, start_time
       FROM cron.job_run_details
       WHERE jobid IN (SELECT jobid FROM target_job)
       ORDER BY start_time DESC
       LIMIT 5
     ), latest_run AS (
       SELECT jobid, start_time FROM recent_runs ORDER BY start_time DESC LIMIT 1
     ), latest_response AS (
       SELECT status_code, timed_out, error_msg, created
       FROM net._http_response
       WHERE url = $1 || '/api/internal/background/tick'
       ORDER BY created DESC
       LIMIT 1
     )
     SELECT
       (SELECT count(*)::integer FROM recent_runs) AS "recentRunCount",
       (SELECT count(*) FILTER (WHERE status = 'succeeded')::integer FROM recent_runs) AS "recentRunSuccessCount",
       coalesce((SELECT start_time >= statement_timestamp() - interval '10 minutes' FROM latest_run), false) AS "latestRunFresh",
       (SELECT status_code FROM latest_response) AS "latestHttpStatusCode",
       (SELECT timed_out FROM latest_response) AS "latestHttpTimedOut",
       (SELECT error_msg IS NOT NULL FROM latest_response) AS "latestHttpErrorPresent",
       coalesce((SELECT response.created >= run.start_time AND response.created <= run.start_time + interval '2 minutes'
         FROM latest_run AS run CROSS JOIN latest_response AS response
         WHERE response.status_code BETWEEN 200 AND 299 AND response.timed_out IS FALSE AND response.error_msg IS NULL), false)
         AS "httpResponseMatchesLatestRun"`, [origin]);
  const evidence = recent.rows[0];
  if (!evidence || !Number.isInteger(evidence.recentRunCount) || evidence.recentRunCount < 0 || evidence.recentRunCount > 5 ||
      !Number.isInteger(evidence.recentRunSuccessCount) || evidence.recentRunSuccessCount < 0 ||
      evidence.recentRunSuccessCount > evidence.recentRunCount ||
      (evidence.latestHttpStatusCode !== null && (!Number.isInteger(evidence.latestHttpStatusCode) ||
        evidence.latestHttpStatusCode < 100 || evidence.latestHttpStatusCode > 599)) ||
      (evidence.latestHttpTimedOut !== null && typeof evidence.latestHttpTimedOut !== "boolean") ||
      (evidence.latestHttpErrorPresent !== null && typeof evidence.latestHttpErrorPresent !== "boolean") ||
      typeof evidence.latestRunFresh !== "boolean" || typeof evidence.httpResponseMatchesLatestRun !== "boolean") {
    throw new Error("SCHEDULER_DELIVERY_INVENTORY_RESPONSE_INVALID");
  }

  const checks = {
    recentRunCount: evidence.recentRunCount,
    recentRunSuccessCount: evidence.recentRunSuccessCount,
    latestRunFresh: evidence.latestRunFresh,
    latestHttpStatusCode: evidence.latestHttpStatusCode,
    latestHttpTimedOut: evidence.latestHttpTimedOut,
    latestHttpErrorPresent: evidence.latestHttpErrorPresent,
    httpResponseMatchesLatestRun: evidence.httpResponseMatchesLatestRun,
    callbackOriginMatchesConfigured: vaultEvidence.callbackMatchesOrigin,
  };
  const verified = vaultEvidence.urlSecretPresent && vaultEvidence.jobSecretPresent && vaultEvidence.callbackMatchesOrigin &&
    evidence.recentRunCount === 5 && evidence.recentRunSuccessCount === 5 && evidence.latestRunFresh &&
    evidence.latestHttpStatusCode !== null && evidence.latestHttpStatusCode >= 200 && evidence.latestHttpStatusCode < 300 &&
    evidence.latestHttpTimedOut === false && evidence.latestHttpErrorPresent === false && evidence.httpResponseMatchesLatestRun;
  const detail = !vaultEvidence.urlSecretPresent || !vaultEvidence.jobSecretPresent
    ? "SUPABASE_NOVA_CRON_VAULT_SECRETS_MISSING"
    : !vaultEvidence.callbackMatchesOrigin
      ? "SUPABASE_NOVA_CRON_CALLBACK_ORIGIN_MISMATCH"
      : evidence.recentRunCount < 5 || evidence.recentRunSuccessCount !== 5 || !evidence.latestRunFresh
        ? "SUPABASE_NOVA_CRON_RECENT_RUNS_NOT_HEALTHY"
        : !evidence.httpResponseMatchesLatestRun
          ? "SUPABASE_NOVA_CRON_HTTP_RESPONSE_NOT_CONFIRMED"
          : "SUPABASE_NOVA_CRON_DELIVERY_VERIFIED";
  return deliveryEvidence(verified ? "verified" : "unverified", detail, checks);
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
  if (error instanceof Error && error.message === "SCHEDULER_DELIVERY_INVENTORY_RESPONSE_INVALID") return error.message;
  if (error instanceof Error && error.message === "MIGRATION_INVENTORY_RESPONSE_INVALID") return error.message;
  if (code === "42501") return "MIGRATOR_PERMISSION_DENIED";
  return "SCHEDULER_READ_FAILED";
}

/** Read only NOVA-owned Supabase Cron rows using the explicitly selected migration-owner URL. */
export async function inspectSupabaseCronInventory(
  environment: Readonly<Record<string, string>>,
  dependencies: {
    connect?: (connectionString: string) => Promise<DatabasePool>;
    read?: (
      client: QueryClient,
      expectedMigrations: readonly ExpectedMigration[] | undefined,
      configuredOrigin: string | undefined,
    ) => Promise<TriggerReadResult>;
    expectedMigrations?: readonly ExpectedMigration[];
    configuredOrigin?: string;
  } = {},
): Promise<SupabaseCronInventory> {
  const connectionString = environment.MIGRATOR_DATABASE_URL;
  if (!connectionString) {
    return {
      state: "target-required",
      completeness: "not-inspected",
      triggers: [],
      deliveryEvidence: deliveryEvidence("unavailable", "SCHEDULER_INVENTORY_NOT_INSPECTED"),
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
      deliveryEvidence: deliveryEvidence("unavailable", "MIGRATOR_DATABASE_TARGET_MISMATCH"),
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
      const result = await (dependencies.read ?? readTriggers)(client, expectedMigrations, dependencies.configuredOrigin ?? environment.NOVA_PUBLIC_ORIGIN);
      return {
        state: result.installed ? "verified" : "not-installed",
        completeness: "project-scoped",
        triggers: result.triggers,
        deliveryEvidence: result.deliveryEvidence ?? deliveryEvidence("unavailable", "SCHEDULER_DELIVERY_EVIDENCE_NOT_RETURNED"),
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
      deliveryEvidence: deliveryEvidence("unavailable", connectionErrorCode(error)),
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
