import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import { migrationSha256 } from "../../server/src/migration-checksum.js";
import { validateSupabaseProjectConfirmation } from "../../server/src/supabase-project-confirmation.js";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../../database/migrations/", import.meta.url),
);
const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const migrationLockName = "nova_schema_migrations";
const checksumColumnMigration = "0076_operator_update_checksums.sql";
const defaultLockWaitMs = 15_000;

export interface CanonicalMigration {
  filename: string;
  sha256: string;
  source: string;
}

export type MigrationHashManifest = Readonly<Record<string, string>>;

export interface MigrationPlan {
  target: string;
  applied: string[];
  pending: CanonicalMigration[];
}

export interface MigrationLedgerEntry {
  filename: string;
  /** Null means this is a legacy filename-only row; source history must be trusted separately. */
  sha256?: string | null;
}

export interface AppliedMigrationSummary {
  target: string;
  applied: string[];
  alreadyApplied: string[];
  pendingBeforeApply: string[];
}

interface QueryResultLike<Row extends QueryResultRow = QueryResultRow> {
  rows: Row[];
}

interface PgQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    query: string,
    values?: unknown[],
  ): Promise<QueryResultLike<Row>>;
}

interface PgClientLike extends PgQueryable {
  release(error?: Error): void;
}

interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

type PgPoolFactory = (connectionString: string) => PgPoolLike | Promise<PgPoolLike>;

export interface PostgresUpdateOptions {
  databaseUrl: string;
  /** Must be the literal target label shown to the operator. */
  confirmation: string;
  targetManifest: MigrationHashManifest;
  /** Hashes from the pinned, trusted currently-installed release. */
  baselineManifest: MigrationHashManifest;
  /** Hashes recorded by the updater journal for target files submitted by this update attempt. */
  verifiedMigrationHashes?: MigrationHashManifest;
  migrationDirectory?: string;
  lockWaitMs?: number;
  createPool?: PgPoolFactory;
  onMigrationStarting?: (filename: string, sha256: string) => void | Promise<void>;
  onMigrationApplied?: (filename: string) => void | Promise<void>;
}

export interface SupabaseUpdateOptions {
  projectRef: string;
  accessToken: string;
  /** Must exactly match projectRef; supplied by the interactive coordinator. */
  confirmation: string;
  targetManifest: MigrationHashManifest;
  /** Hashes from the pinned, trusted currently-installed release. */
  baselineManifest: MigrationHashManifest;
  /** Hashes recorded by the updater journal for target files submitted by this update attempt. */
  verifiedMigrationHashes?: MigrationHashManifest;
  migrationDirectory?: string;
  request?: typeof fetch;
  onMigrationStarting?: (filename: string, sha256: string) => void | Promise<void>;
  onMigrationApplied?: (filename: string) => void | Promise<void>;
}

export function sha256(source: string | Uint8Array): string {
  return migrationSha256(source);
}

export function postgresTargetLabel(connectionString: string): string {
  const parsed = parsePostgresUrl(connectionString);
  const host = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
  const port = parsed.port || "5432";
  return `PostgreSQL ${host}:${port}/${decodeUrlPart(parsed.pathname.slice(1))} as ${decodeUrlPart(parsed.username) || "(default user)"}`;
}

/** Match migration-owner and application-role URLs by the database endpoint. */
export function postgresUrlsReferToSameDatabase(migrationUrl: string, applicationUrl: string): boolean {
  const migration = parsePostgresUrl(migrationUrl);
  const application = parsePostgresUrl(applicationUrl);
  const hostname = migration.hostname.toLowerCase();
  const sameHost = hostname === application.hostname.toLowerCase();
  const sameDatabase = decodeUrlPart(migration.pathname.slice(1)) === decodeUrlPart(application.pathname.slice(1));
  const migrationPort = migration.port || "5432";
  const applicationPort = application.port || "5432";
  if (!sameDatabase) return false;

  const migrationProject = supabaseProjectFromPostgresUrl(migration);
  const applicationProject = supabaseProjectFromPostgresUrl(application);
  if (migrationProject || applicationProject) {
    return migrationProject !== undefined && migrationProject === applicationProject &&
      isSupportedSupabasePostgresEndpoint(migration.hostname, migrationPort, migrationProject) &&
      isSupportedSupabasePostgresEndpoint(application.hostname, applicationPort, applicationProject);
  }
  return sameHost && migrationPort === applicationPort;
}

/** Accept only a direct Supabase database host or pooler username bound to this project ref. */
export function supabaseUrlBelongsToProject(connectionString: string, projectRef: string): boolean {
  const parsed = parsePostgresUrl(connectionString);
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || "5432";
  const urlProject = supabaseProjectFromPostgresUrl(parsed);
  return urlProject === projectRef.toLowerCase() && isSupportedSupabasePostgresEndpoint(hostname, port, urlProject);
}

function supabaseProjectFromPostgresUrl(parsed: URL): string | undefined {
  const directHost = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(parsed.hostname);
  if (directHost) return directHost[1]!.toLowerCase();
  if (!parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com")) return undefined;
  const projectRef = decodeUrlPart(parsed.username).toLowerCase().split(".").at(-1);
  return projectRef && /^[a-z0-9]{20}$/.test(projectRef) ? projectRef : undefined;
}

function isSupportedSupabasePostgresEndpoint(hostname: string, port: string, projectRef: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  if (normalizedHost === `db.${projectRef}.supabase.co`) return port === "5432";
  return normalizedHost.endsWith(".pooler.supabase.com") && (port === "5432" || port === "6543");
}

export function requireExactTargetConfirmation(target: string, confirmation: string | undefined): void {
  if (confirmation === undefined || confirmation.length === 0) {
    throw new Error("DATABASE_TARGET_CONFIRMATION_REQUIRED");
  }
  if (confirmation !== target) {
    throw new Error("DATABASE_TARGET_CONFIRMATION_MISMATCH");
  }
}

export async function loadCanonicalMigrations(
  targetManifest: MigrationHashManifest,
  migrationDirectory = defaultMigrationDirectory,
): Promise<CanonicalMigration[]> {
  assertManifest(targetManifest, "TARGET");
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => migrationFilenamePattern.test(filename))
    .sort();
  const manifestFilenames = Object.keys(targetManifest).sort();

  if (
    filenames.length !== manifestFilenames.length ||
    filenames.some((filename, index) => filename !== manifestFilenames[index])
  ) {
    throw new Error("TARGET_MIGRATION_FILE_SET_MISMATCH");
  }

  const migrations: CanonicalMigration[] = [];
  for (const filename of filenames) {
    const source = await readFile(join(migrationDirectory, filename), "utf8");
    const digest = sha256(source);
    if (digest !== targetManifest[filename]) {
      throw new Error(`TARGET_MIGRATION_HASH_MISMATCH:${filename}`);
    }
    migrations.push({ filename, sha256: digest, source });
  }

  return migrations;
}

export function reconcileMigrationLedger(
  appliedEntries: readonly (string | MigrationLedgerEntry)[],
  baselineManifest: MigrationHashManifest,
  targetManifest: MigrationHashManifest,
  targetLabel: string,
  canonicalMigrations: readonly CanonicalMigration[],
  verifiedMigrationHashes: MigrationHashManifest = {},
): MigrationPlan {
  assertManifest(baselineManifest, "BASELINE");
  assertManifest(targetManifest, "TARGET");
  if (appliedEntries.length === 0) {
    throw new Error("DATABASE_MIGRATION_BASELINE_EMPTY");
  }

  const baselineFiles = Object.keys(baselineManifest).sort();
  const targetFiles = Object.keys(targetManifest).sort();
  if (targetFiles.length < baselineFiles.length) {
    throw new Error("DATABASE_TARGET_RELEASE_OLDER_THAN_BASELINE");
  }

  for (let index = 0; index < baselineFiles.length; index += 1) {
    const filename = baselineFiles[index]!;
    if (targetFiles[index] !== filename || targetManifest[filename] !== baselineManifest[filename]) {
      throw new Error(`HISTORICAL_MIGRATION_CHANGED:${filename}`);
    }
  }
  for (const [filename, digest] of Object.entries(verifiedMigrationHashes)) {
    if (!migrationFilenamePattern.test(filename) || targetManifest[filename] !== digest) {
      throw new Error(`VERIFIED_ATTEMPT_MANIFEST_INVALID:${filename}`);
    }
  }

  const entries = appliedEntries.map((entry) => typeof entry === "string" ? { filename: entry } : entry);
  const applied = [...new Set(entries.map((entry) => entry.filename))].sort();
  if (applied.length !== entries.length) {
    throw new Error("DATABASE_MIGRATION_LEDGER_DUPLICATE");
  }
  for (const filename of applied) {
    if (!migrationFilenamePattern.test(filename)) {
      throw new Error("DATABASE_MIGRATION_LEDGER_INVALID");
    }
    if (!(filename in targetManifest)) {
      throw new Error(`DATABASE_HAS_UNKNOWN_OR_NEWER_MIGRATION:${filename}`);
    }
  }

  for (const entry of entries) {
    if (entry.sha256 === undefined || entry.sha256 === null) {
      if (entry.filename === checksumColumnMigration) {
        throw new Error("MIGRATION_CHECKSUM_COLUMN_MISSING");
      }
      if (
        !(entry.filename in baselineManifest) &&
        verifiedMigrationHashes[entry.filename] !== targetManifest[entry.filename]
      ) {
        throw new Error(`DATABASE_MIGRATION_CHECKSUM_MISSING:${entry.filename}`);
      }
      continue;
    }
    if (!sha256Pattern.test(entry.sha256)) {
      throw new Error(`DATABASE_MIGRATION_CHECKSUM_INVALID:${entry.filename}`);
    }
    const trustedDigest = baselineManifest[entry.filename] ?? targetManifest[entry.filename];
    if (
      entry.sha256 !== trustedDigest ||
      (entry.filename in verifiedMigrationHashes && verifiedMigrationHashes[entry.filename] !== entry.sha256)
    ) {
      throw new Error(`DATABASE_MIGRATION_CHECKSUM_MISMATCH:${entry.filename}`);
    }
  }

  // The current runner applies migrations in lexical order. A gap means this
  // ledger cannot be treated as a known NOVA upgrade baseline.
  for (let index = 0; index < applied.length; index += 1) {
    if (targetFiles[index] !== applied[index]) {
      throw new Error(`DATABASE_MIGRATION_LEDGER_GAP:${applied[index]}`);
    }
  }

  const canonicalByName = new Map(canonicalMigrations.map((migration) => [migration.filename, migration]));
  const alreadyApplied = new Set(applied);
  const pending = canonicalMigrations.filter((migration) => !alreadyApplied.has(migration.filename));

  for (const filename of applied) {
    const canonical = canonicalByName.get(filename);
    const trustedDigest = baselineManifest[filename] ?? targetManifest[filename];
    if (!canonical || canonical.sha256 !== trustedDigest) {
      throw new Error(`APPLIED_MIGRATION_HASH_UNVERIFIABLE:${filename}`);
    }
  }

  return { target: targetLabel, applied, pending };
}

export async function planPostgresUpdate(options: PostgresUpdateOptions): Promise<MigrationPlan> {
  const target = postgresTargetLabel(options.databaseUrl);
  requireExactTargetConfirmation(target, options.confirmation);
  assertPostgresConnectionSecurity(options.databaseUrl);
  const migrations = await loadCanonicalMigrations(options.targetManifest, options.migrationDirectory);
  const pool = await (options.createPool ?? defaultPoolFactory)(options.databaseUrl);
  try {
    const client = await pool.connect();
    try {
      await verifyPostgresConnection(client, options.databaseUrl);
      const ledger = await readPostgresLedger(client);
      return reconcileMigrationLedger(
        ledger,
        options.baselineManifest,
        options.targetManifest,
        target,
        migrations,
        options.verifiedMigrationHashes,
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function applyPostgresUpdate(options: PostgresUpdateOptions): Promise<AppliedMigrationSummary> {
  const target = postgresTargetLabel(options.databaseUrl);
  requireExactTargetConfirmation(target, options.confirmation);
  assertPostgresConnectionSecurity(options.databaseUrl);
  const migrations = await loadCanonicalMigrations(options.targetManifest, options.migrationDirectory);
  const pool = await (options.createPool ?? defaultPoolFactory)(options.databaseUrl);
  const appliedDuringRun: string[] = [];
  let client: PgClientLike | undefined;
  let lockHeld = false;
  let initialPlan: MigrationPlan | undefined;

  try {
    client = await pool.connect();
    await verifyPostgresConnection(client, options.databaseUrl);
    await acquirePostgresMigrationLock(client, options.lockWaitMs ?? defaultLockWaitMs);
    lockHeld = true;

    const ledger = await readPostgresLedger(client);
    initialPlan = reconcileMigrationLedger(
      ledger,
      options.baselineManifest,
      options.targetManifest,
      target,
      migrations,
      options.verifiedMigrationHashes,
    );
    if (await postgresLedgerHasSha256(client)) {
      await client.query("BEGIN");
      try {
        await backfillPostgresAttemptChecksums(
          client,
          options.verifiedMigrationHashes ?? {},
          options.baselineManifest,
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }

    for (const migration of initialPlan.pending) {
      const currentLedger = await readPostgresLedger(client);
      const currentPlan = reconcileMigrationLedger(
        currentLedger,
        options.baselineManifest,
        options.targetManifest,
        target,
        migrations,
        mergeAttemptManifest(options.verifiedMigrationHashes, appliedDuringRun, migrations),
      );
      if (!currentPlan.pending.some((pending) => pending.filename === migration.filename)) {
        continue;
      }

      await options.onMigrationStarting?.(migration.filename, migration.sha256);
      try {
        await client.query("BEGIN");
        await client.query(migration.source);
        if (await postgresLedgerHasSha256(client)) {
          await backfillPostgresAttemptChecksums(
            client,
            mergeAttemptManifest(options.verifiedMigrationHashes, appliedDuringRun, migrations),
            options.baselineManifest,
            migration.filename,
          );
          await client.query(
            "INSERT INTO public.nova_schema_migrations (filename, sha256) VALUES ($1, $2)",
            [migration.filename, migration.sha256],
          );
        } else {
          await client.query(
            "INSERT INTO public.nova_schema_migrations (filename) VALUES ($1)",
            [migration.filename],
          );
        }
        await client.query("COMMIT");
        appliedDuringRun.push(migration.filename);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const failedClient = client;
        client = undefined;
        const reconciled = await reconcilePostgresAfterFailure(
          pool,
          options,
          migrations,
          target,
          migration.filename,
          failedClient,
          mergeAttemptManifest(options.verifiedMigrationHashes, appliedDuringRun, migrations),
        );
        client = reconciled.client;
        lockHeld = reconciled.lockHeld;
        if (reconciled.applied) {
          appliedDuringRun.push(migration.filename);
          await options.onMigrationApplied?.(migration.filename);
          continue;
        }
        throw new Error(`POSTGRES_MIGRATION_FAILED:${migration.filename}:${safeErrorCode(error)}`);
      }
      await options.onMigrationApplied?.(migration.filename);
    }

    return {
      target,
      applied: appliedDuringRun,
      alreadyApplied: initialPlan.applied,
      pendingBeforeApply: initialPlan.pending.map((migration) => migration.filename),
    };
  } finally {
    if (client && lockHeld) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [migrationLockName])
        .catch(() => undefined);
    }
    client?.release();
    await pool.end();
  }
}

export async function planSupabaseUpdate(options: SupabaseUpdateOptions): Promise<MigrationPlan> {
  const target = validateSupabaseTarget(options.projectRef, options.confirmation, options.accessToken);
  const migrations = await loadCanonicalMigrations(options.targetManifest, options.migrationDirectory);
  const ledger = await readSupabaseLedger(options);
  return reconcileMigrationLedger(
    ledger,
    options.baselineManifest,
    options.targetManifest,
    target,
    migrations,
    options.verifiedMigrationHashes,
  );
}

export async function applySupabaseUpdate(options: SupabaseUpdateOptions): Promise<AppliedMigrationSummary> {
  const target = validateSupabaseTarget(options.projectRef, options.confirmation, options.accessToken);
  const migrations = await loadCanonicalMigrations(options.targetManifest, options.migrationDirectory);
  const initialLedger = await readSupabaseLedger(options);
  let initialPlan = reconcileMigrationLedger(
    initialLedger,
    options.baselineManifest,
    options.targetManifest,
    target,
    migrations,
    options.verifiedMigrationHashes,
  );
  await backfillSupabaseAttemptChecksums(
    options,
    options.verifiedMigrationHashes ?? {},
    options.baselineManifest,
  );
  const postBackfillLedger = await readSupabaseLedger(options);
  initialPlan = reconcileMigrationLedger(
    postBackfillLedger,
    options.baselineManifest,
    options.targetManifest,
    target,
    migrations,
    options.verifiedMigrationHashes,
  );
  const appliedDuringRun: string[] = [];

  for (const migration of initialPlan.pending) {
    // Re-read immediately before each write so a concurrent operator can be
    // detected when they have already committed a NOVA ledger entry.
    const currentLedger = await readSupabaseLedger(options);
    const currentPlan = reconcileMigrationLedger(
      currentLedger,
      options.baselineManifest,
      options.targetManifest,
      target,
      migrations,
      mergeAttemptManifest(options.verifiedMigrationHashes, appliedDuringRun, migrations),
    );
    if (!currentPlan.pending.some((pending) => pending.filename === migration.filename)) {
      if (!initialPlan.applied.includes(migration.filename)) {
        appliedDuringRun.push(migration.filename);
        await options.onMigrationApplied?.(migration.filename);
      }
      continue;
    }

    await options.onMigrationStarting?.(migration.filename, migration.sha256);
    const attemptHashes = mergeAttemptManifest(
      options.verifiedMigrationHashes,
      appliedDuringRun,
      migrations,
    );
    const checksumBackfill = supabaseChecksumBackfillSql(
      attemptHashes,
      options.baselineManifest,
      migration.filename,
    );
    let requestFailed = false;
    try {
      await supabaseRequest(options, "database/migrations", {
        method: "POST",
        body: {
          name: migration.filename.slice(0, -4),
          query: [
            // Supabase's migrations endpoint runs each migration as a unit and
            // rolls it back on failure. Use the same advisory key as the direct
            // runner, but fail quickly on contention; this does not coordinate
            // with writers that do not take the NOVA advisory lock.
            `DO $$ BEGIN IF NOT pg_try_advisory_xact_lock(hashtextextended('${migrationLockName}', 0)) THEN RAISE EXCEPTION 'NOVA_MIGRATION_LOCK_BUSY'; END IF; IF EXISTS (SELECT 1 FROM public.nova_schema_migrations WHERE filename = ${sqlLiteral(migration.filename)}) THEN RAISE EXCEPTION 'NOVA_MIGRATION_ALREADY_APPLIED'; END IF; END; $$;`,
            migration.source,
            checksumBackfill,
            `DO $nova_checksum$ DECLARE has_sha256 boolean; BEGIN SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations' AND column_name = 'sha256') INTO has_sha256; IF has_sha256 THEN EXECUTE 'INSERT INTO public.nova_schema_migrations (filename, sha256) VALUES ($1, $2)' USING ${sqlLiteral(migration.filename)}, ${sqlLiteral(migration.sha256)}; ELSE INSERT INTO public.nova_schema_migrations (filename) VALUES (${sqlLiteral(migration.filename)}); END IF; END; $nova_checksum$;`,
          ].join("\n\n"),
        },
      });
    } catch {
      // Never include transport errors or response bodies: either can contain
      // credentials or SQL. The ledger is the only safe reconciliation source.
      requestFailed = true;
    }

    let reconciledLedger: MigrationLedgerEntry[];
    try {
      reconciledLedger = await readSupabaseLedger(options);
    } catch {
      throw new Error(`SUPABASE_MIGRATION_OUTCOME_UNKNOWN:${migration.filename}`);
    }
    let reconciledPlan: MigrationPlan;
    try {
      reconciledPlan = reconcileMigrationLedger(
        reconciledLedger,
        options.baselineManifest,
        options.targetManifest,
        target,
        migrations,
        mergeAttemptManifest(
          options.verifiedMigrationHashes,
          requestFailed ? appliedDuringRun : [...appliedDuringRun, migration.filename],
          migrations,
        ),
      );
    } catch (error) {
      if (requestFailed && reconciledLedger.some((entry) => entry.filename === migration.filename)) {
        throw new Error(`SUPABASE_MIGRATION_OUTCOME_UNKNOWN:${migration.filename}`);
      }
      throw error;
    }
    if (reconciledPlan.pending.some((pending) => pending.filename === migration.filename)) {
      if (requestFailed) {
        // Could have partially executed before the ledger insert. Do not retry
        // automatically; a human must inspect the target schema first.
        throw new Error(`SUPABASE_MIGRATION_OUTCOME_UNKNOWN:${migration.filename}`);
      }
      throw new Error(`SUPABASE_MIGRATION_LEDGER_NOT_UPDATED:${migration.filename}`);
    }

    appliedDuringRun.push(migration.filename);
    await options.onMigrationApplied?.(migration.filename);
    // A lost response is resolved by a ledger read under the next operation;
    // the coordinator also journals this verified commit via the callback.
    void requestFailed;
  }

  return {
    target,
    applied: appliedDuringRun,
    alreadyApplied: initialPlan.applied,
    pendingBeforeApply: initialPlan.pending.map((migration) => migration.filename),
  };
}

function validateSupabaseTarget(projectRef: string, confirmation: string, accessToken: string): string {
  validateSupabaseProjectConfirmation(projectRef, confirmation);
  if (!accessToken || accessToken.trim() !== accessToken) {
    throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED");
  }
  return `Supabase project ${projectRef}`;
}

async function readSupabaseLedger(options: SupabaseUpdateOptions): Promise<MigrationLedgerEntry[]> {
  const ledgerState = await supabaseRequest(options, "database/query", {
    method: "POST",
    body: {
      query: `SELECT to_regclass('public.nova_schema_migrations') IS NOT NULL AS ledger_exists, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations' AND column_name = 'sha256') AS has_sha256`,
    },
  });
  if (
    !Array.isArray(ledgerState) || typeof ledgerState[0] !== "object" || ledgerState[0] === null ||
    (ledgerState[0] as { ledger_exists?: unknown }).ledger_exists !== true
  ) {
    throw new Error("DATABASE_MIGRATION_BASELINE_UNKNOWN");
  }
  const hasSha256 = (ledgerState[0] as { has_sha256?: unknown }).has_sha256 === true;
  const result = await supabaseRequest(options, "database/query", {
    method: "POST",
    body: {
      query: hasSha256
        ? "SELECT filename, sha256 FROM public.nova_schema_migrations ORDER BY filename"
        : "SELECT filename FROM public.nova_schema_migrations ORDER BY filename",
    },
  });
  if (!Array.isArray(result)) {
    throw new Error("SUPABASE_MIGRATION_LEDGER_RESPONSE_INVALID");
  }
  const entries = result.map((row) => {
    if (
      typeof row !== "object" || row === null ||
      typeof (row as { filename?: unknown }).filename !== "string"
    ) {
      throw new Error("SUPABASE_MIGRATION_LEDGER_RESPONSE_INVALID");
    }
    const ledgerRow = row as { filename: string; sha256?: unknown };
    if (hasSha256 && ledgerRow.sha256 !== null && typeof ledgerRow.sha256 !== "string") {
      throw new Error("SUPABASE_MIGRATION_LEDGER_RESPONSE_INVALID");
    }
    return { filename: ledgerRow.filename, sha256: hasSha256 ? ledgerRow.sha256 as string | null : null };
  });
  if (!hasSha256 && entries.some(({ filename }) => filename >= checksumColumnMigration)) {
    throw new Error("MIGRATION_CHECKSUM_COLUMN_MISSING");
  }
  return entries;
}

async function supabaseRequest(
  options: SupabaseUpdateOptions,
  endpoint: "database/query" | "database/migrations",
  request: { method: "POST"; body: unknown },
): Promise<unknown> {
  const fetcher = options.request ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `https://api.supabase.com/v1/projects/${options.projectRef}/${endpoint}`,
      {
        method: request.method,
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(endpoint === "database/migrations" ? 180_000 : 30_000),
      },
    );
  } catch {
    throw new Error(`SUPABASE_REQUEST_TRANSPORT_FAILED:${endpoint}`);
  }
  if (!response.ok) {
    throw new Error(`SUPABASE_REQUEST_FAILED_${response.status}:${endpoint}`);
  }
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch {
    throw new Error(`SUPABASE_RESPONSE_INVALID:${endpoint}`);
  }
}

async function backfillSupabaseAttemptChecksums(
  options: SupabaseUpdateOptions,
  verifiedMigrationHashes: MigrationHashManifest,
  baselineManifest: MigrationHashManifest,
): Promise<void> {
  const mappings = checksumBackfillEntries(verifiedMigrationHashes, baselineManifest);
  if (mappings.length === 0) return;

  const state = await supabaseRequest(options, "database/query", {
    method: "POST",
    body: {
      query: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations' AND column_name = 'sha256') AS has_sha256`,
    },
  });
  if (!Array.isArray(state) || typeof state[0] !== "object" || state[0] === null) {
    throw new Error("MIGRATION_CHECKSUM_BACKFILL_FAILED");
  }
  if ((state[0] as { has_sha256?: unknown }).has_sha256 !== true) return;

  const values = mappings.map(([filename, digest]) =>
    `(${sqlLiteral(filename)}::text, ${sqlLiteral(digest)}::text)`
  ).join(", ");
  const update = `UPDATE public.nova_schema_migrations AS ledger SET sha256 = expected.sha256 FROM (VALUES ${values}) AS expected(filename, sha256) WHERE ledger.filename = expected.filename AND ledger.sha256 IS NULL`;
  try {
    await supabaseRequest(options, "database/query", {
      method: "POST",
      body: { query: update },
    });
  } catch {
    // Re-read below. A timeout is safe to reconcile because this is one
    // idempotent UPDATE statement and cannot alter schema/data rows.
  }
  const ledger = await readSupabaseLedger(options);
  verifyAttemptChecksumsPersisted(ledger, mappings);
}

function supabaseChecksumBackfillSql(
  verifiedMigrationHashes: MigrationHashManifest,
  baselineManifest: MigrationHashManifest,
  currentFilename: string,
): string {
  const mappings = checksumBackfillEntries(verifiedMigrationHashes, baselineManifest)
    .filter(([filename]) => filename !== currentFilename);
  if (mappings.length === 0) return "";
  const values = mappings.map(([filename, digest]) =>
    `(${sqlLiteral(filename)}::text, ${sqlLiteral(digest)}::text)`
  ).join(", ");
  return `DO $nova_backfill$ DECLARE has_sha256 boolean; BEGIN SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations' AND column_name = 'sha256') INTO has_sha256; IF has_sha256 THEN UPDATE public.nova_schema_migrations AS ledger SET sha256 = expected.sha256 FROM (VALUES ${values}) AS expected(filename, sha256) WHERE ledger.filename = expected.filename AND ledger.sha256 IS NULL; IF EXISTS (SELECT 1 FROM public.nova_schema_migrations AS ledger JOIN (VALUES ${values}) AS expected(filename, sha256) ON expected.filename = ledger.filename WHERE ledger.sha256 IS NOT NULL AND ledger.sha256 <> expected.sha256) THEN RAISE EXCEPTION 'NOVA_MIGRATION_CHECKSUM_MISMATCH'; END IF; END IF; END; $nova_backfill$;`;
}

function checksumBackfillEntries(
  verifiedMigrationHashes: MigrationHashManifest,
  baselineManifest: MigrationHashManifest,
): Array<[string, string]> {
  const entries = Object.entries(verifiedMigrationHashes)
    .filter(([filename]) => !(filename in baselineManifest))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [filename, digest] of entries) {
    if (!migrationFilenamePattern.test(filename) || !sha256Pattern.test(digest)) {
      throw new Error(`VERIFIED_ATTEMPT_MANIFEST_INVALID:${filename}`);
    }
  }
  return entries;
}

function verifyAttemptChecksumsPersisted(
  ledger: readonly MigrationLedgerEntry[],
  mappings: readonly (readonly [string, string])[],
): void {
  const byFilename = new Map(ledger.map((entry) => [entry.filename, entry]));
  for (const [filename, digest] of mappings) {
    const entry = byFilename.get(filename);
    if (entry && entry.sha256 !== digest) {
      throw new Error(`MIGRATION_CHECKSUM_BACKFILL_FAILED:${filename}`);
    }
  }
}

async function verifyPostgresConnection(client: PgQueryable, connectionString: string): Promise<void> {
  const parsed = assertPostgresConnectionSecurity(connectionString);

  const result = await client.query<{
    current_database: string;
    current_user: string;
    transaction_read_only: string;
    ledger_exists: boolean;
  }>(`
    SELECT current_database() AS current_database,
           current_user AS current_user,
           current_setting('transaction_read_only') AS transaction_read_only,
           to_regclass('public.nova_schema_migrations') IS NOT NULL AS ledger_exists
  `);
  const row = result.rows[0];
  if (!row || row.current_database !== decodeUrlPart(parsed.pathname.slice(1))) {
    throw new Error("POSTGRES_TARGET_DATABASE_MISMATCH");
  }
  if (row.current_user !== decodeUrlPart(parsed.username)) {
    throw new Error("POSTGRES_TARGET_ROLE_MISMATCH");
  }
  if (/^nova_app(?:\.|$)/i.test(row.current_user)) {
    throw new Error("POSTGRES_MIGRATOR_ROLE_REQUIRED");
  }
  if (row.transaction_read_only === "on") {
    throw new Error("POSTGRES_TARGET_READ_ONLY");
  }
  if (!row.ledger_exists) {
    throw new Error("DATABASE_MIGRATION_BASELINE_UNKNOWN");
  }
}

async function readPostgresLedger(client: PgQueryable): Promise<MigrationLedgerEntry[]> {
  const state = await client.query<{ ledger_exists: boolean; has_sha256: boolean }>(`
    SELECT to_regclass('public.nova_schema_migrations') IS NOT NULL AS ledger_exists,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations'
                     AND column_name = 'sha256') AS has_sha256
  `);
  if (!state.rows[0]?.ledger_exists) {
    throw new Error("DATABASE_MIGRATION_BASELINE_UNKNOWN");
  }
  const hasSha256 = state.rows[0]?.has_sha256 === true;
  const result = await client.query<{ filename: string; sha256?: string | null }>(
    hasSha256
      ? "SELECT filename, sha256 FROM public.nova_schema_migrations ORDER BY filename"
      : "SELECT filename FROM public.nova_schema_migrations ORDER BY filename",
  );
  if (!Array.isArray(result.rows) || result.rows.some((row) => typeof row.filename !== "string")) {
    throw new Error("DATABASE_MIGRATION_LEDGER_INVALID");
  }
  if (hasSha256 && result.rows.some((row) => row.sha256 !== null && typeof row.sha256 !== "string")) {
    throw new Error("DATABASE_MIGRATION_LEDGER_INVALID");
  }
  if (!hasSha256 && result.rows.some((row) => row.filename >= checksumColumnMigration)) {
    throw new Error("MIGRATION_CHECKSUM_COLUMN_MISSING");
  }
  return result.rows.map((row) => ({ filename: row.filename, sha256: hasSha256 ? row.sha256 ?? null : null }));
}

async function postgresLedgerHasSha256(client: PgQueryable): Promise<boolean> {
  const result = await client.query<{ has_sha256: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'nova_schema_migrations'
                     AND column_name = 'sha256') AS has_sha256
  `);
  return result.rows[0]?.has_sha256 === true;
}

async function backfillPostgresAttemptChecksums(
  client: PgQueryable,
  verifiedMigrationHashes: MigrationHashManifest,
  baselineManifest: MigrationHashManifest,
  currentFilename?: string,
): Promise<void> {
  const mappings = checksumBackfillEntries(verifiedMigrationHashes, baselineManifest)
    .filter(([filename]) => filename !== currentFilename);
  for (const [filename, digest] of mappings) {
    await client.query(
      "UPDATE public.nova_schema_migrations SET sha256 = $2 WHERE filename = $1 AND sha256 IS NULL",
      [filename, digest],
    );
    const check = await client.query<{ sha256: string | null }>(
      "SELECT sha256 FROM public.nova_schema_migrations WHERE filename = $1",
      [filename],
    );
    if (check.rows[0] && check.rows[0].sha256 !== digest) {
      throw new Error(`MIGRATION_CHECKSUM_BACKFILL_FAILED:${filename}`);
    }
  }
}

async function acquirePostgresMigrationLock(client: PgQueryable, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  do {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [migrationLockName],
    );
    if (result.rows[0]?.acquired === true) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() - startedAt < timeoutMs);
  throw new Error("DATABASE_MIGRATION_LOCK_TIMEOUT");
}

async function reconcilePostgresAfterFailure(
  pool: PgPoolLike,
  options: PostgresUpdateOptions,
  migrations: readonly CanonicalMigration[],
  target: string,
  filename: string,
  failedClient: PgClientLike,
  verifiedMigrationHashes: MigrationHashManifest,
): Promise<{ applied: boolean; client: PgClientLike; lockHeld: boolean }> {
  // The COMMIT response may have been lost. Drop the old session, then reacquire
  // the same advisory lock before reading truth from the ledger.
  failedClient.release(new Error("POSTGRES_MIGRATION_OUTCOME_UNKNOWN"));
  const client = await pool.connect();
  try {
    await verifyPostgresConnection(client, options.databaseUrl);
    await acquirePostgresMigrationLock(client, options.lockWaitMs ?? defaultLockWaitMs);
    const ledger = await readPostgresLedger(client);
    const plan = reconcileMigrationLedger(
      ledger,
      options.baselineManifest,
      options.targetManifest,
      target,
      migrations,
      mergeAttemptManifest(verifiedMigrationHashes, [filename], migrations),
    );
    return { applied: !plan.pending.some((migration) => migration.filename === filename), client, lockHeld: true };
  } catch (error) {
    client.release();
    throw new Error(`POSTGRES_MIGRATION_RECONCILIATION_FAILED:${filename}:${safeErrorCode(error)}`);
  }
}

function mergeAttemptManifest(
  journalManifest: MigrationHashManifest | undefined,
  appliedDuringRun: readonly string[],
  migrations: readonly CanonicalMigration[],
): MigrationHashManifest {
  const hashes = new Map(Object.entries(journalManifest ?? {}));
  const canonical = new Map(migrations.map((migration) => [migration.filename, migration.sha256]));
  for (const filename of appliedDuringRun) {
    const digest = canonical.get(filename);
    if (digest) hashes.set(filename, digest);
  }
  return Object.fromEntries(hashes);
}

function parsePostgresUrl(connectionString: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("POSTGRES_CONNECTION_URL_INVALID");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname || !parsed.pathname || parsed.pathname === "/" ||
    parsed.username.length === 0
  ) {
    throw new Error("POSTGRES_CONNECTION_URL_INVALID");
  }
  return parsed;
}

/** Validate the URL before creating a pool so credentials are never sent through an unverified TLS session. */
function assertPostgresConnectionSecurity(connectionString: string): URL {
  const parsed = parsePostgresUrl(connectionString);
  const poolMode = parsed.searchParams.get("pool_mode")?.toLowerCase() ??
    parsed.searchParams.get("pooling")?.toLowerCase();
  if (
    poolMode === "transaction" || parsed.searchParams.get("pgbouncer")?.toLowerCase() === "true" ||
    (parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com") && parsed.port === "6543")
  ) {
    throw new Error("POSTGRES_TRANSACTION_POOLER_UNSUPPORTED");
  }
  if (!localHosts.has(parsed.hostname.toLowerCase())) {
    const sslModes = parsed.searchParams.getAll("sslmode");
    if (sslModes.length !== 1 || sslModes[0] !== "verify-full") {
      throw new Error("POSTGRES_REMOTE_TLS_VERIFY_FULL_REQUIRED");
    }
  }
  return parsed;
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("POSTGRES_CONNECTION_URL_INVALID");
  }
}

function assertManifest(manifest: MigrationHashManifest, label: "BASELINE" | "TARGET"): void {
  const filenames = Object.keys(manifest);
  if (filenames.length === 0) {
    throw new Error(`${label}_MIGRATION_MANIFEST_EMPTY`);
  }
  for (const [filename, digest] of Object.entries(manifest)) {
    if (!migrationFilenamePattern.test(filename) || !sha256Pattern.test(digest)) {
      throw new Error(`${label}_MIGRATION_MANIFEST_INVALID`);
    }
  }
}

function sqlLiteral(value: string): string {
  if (value.includes("\0")) throw new Error("MIGRATION_FILENAME_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,100}$/.test(error.message)) {
    return error.message;
  }
  return "DATABASE_ERROR";
}

const defaultPoolFactory: PgPoolFactory = async (connectionString) => {
  const { Pool } = await import("pg");
  return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 }) as unknown as PgPoolLike;
};
