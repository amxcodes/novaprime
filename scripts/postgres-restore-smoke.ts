import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { isSecretsEncryptionKeyValid, encryptSecret, decryptSecret } from "../server/src/secrets.ts";

type QueryPool = {
  query<T extends Record<string, unknown>>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  connect(): Promise<QueryClient>;
  end(): Promise<void>;
};

type QueryClient = {
  query<T extends Record<string, unknown>>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

const sourceUrl = requiredUrl("MIGRATOR_DATABASE_URL");
const sourceAppUrl = requiredUrl("DATABASE_URL");
const secretEnvironment = { NOVA_SECRETS_ENCRYPTION_KEY: process.env.NOVA_SECRETS_ENCRYPTION_KEY };
if (!isSecretsEncryptionKeyValid(secretEnvironment)) throw new Error("RESTORE_QA_ENCRYPTION_KEY_INVALID");
if (sourceUrl.hostname !== "postgres-qa" || sourceUrl.port !== "5432" ||
    sourceUrl.username !== "nova_migrator" || !/^\/nova_qa_[a-f0-9_]+$/.test(sourceUrl.pathname)) {
  throw new Error("RESTORE_QA_SOURCE_MUST_BE_RUN_SCOPED_COMPOSE_DATABASE");
}
if (sourceAppUrl.hostname !== sourceUrl.hostname || sourceAppUrl.port !== sourceUrl.port ||
    sourceAppUrl.pathname !== sourceUrl.pathname || sourceAppUrl.username !== "nova_app") {
  throw new Error("RESTORE_QA_APPLICATION_URL_MUST_MATCH_SOURCE_DATABASE");
}

const pgModule = await import("../server/node_modules/pg/lib/index.js") as unknown as {
  Pool: new (configuration: { connectionString: string; max: number }) => QueryPool;
};
const source = new pgModule.Pool({ connectionString: sourceUrl.toString(), max: 8 });
const targetName = `nova_restore_${randomUUID().replaceAll("-", "")}`;
const targetIdentifier = `"${targetName}"`;
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${targetName}`;
const targetAppUrl = new URL(sourceAppUrl);
targetAppUrl.pathname = `/${targetName}`;
const fixtureId = randomUUID();
const fixture = {
  authUserId: `qa-restore-${fixtureId}`,
  email: `qa-restore-${fixtureId}@example.test`,
  sessionId: `qa-restore-session-${fixtureId}`,
  sessionToken: `qa-restore-token-${randomUUID()}`,
  orgOne: randomUUID(),
  orgTwo: randomUUID(),
  personOne: randomUUID(),
  personTwo: randomUUID(),
  secretConnectionId: randomUUID(),
  encryptedCredential: `qa-restore-api-key-${randomUUID()}`,
};
const credentialCiphertext = encryptSecret(
  JSON.stringify({ apiKey: fixture.encryptedCredential }),
  secretEnvironment,
);
const workDirectory = await mkdtemp(join(tmpdir(), `nova-restore-${fixtureId}-`));
await chmod(workDirectory, 0o700);
const dumpPath = `${workDirectory}/nova.dump`;
let targetCreated = false;
let target: QueryPool | undefined;

function requiredUrl(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  try { return new URL(value); } catch { throw new Error(`${name}_INVALID`); }
}

function tool(label: string, command: string, args: string[], database: URL): string {
  const environment = { ...process.env };
  environment.PGHOST = database.hostname;
  environment.PGPORT = database.port || "5432";
  environment.PGDATABASE = decodeURIComponent(database.pathname.slice(1));
  environment.PGUSER = decodeURIComponent(database.username);
  environment.PGPASSWORD = decodeURIComponent(database.password);
  environment.PGSSLMODE = database.searchParams.get("sslmode") ?? "verify-full";
  const rootCertificate = database.searchParams.get("sslrootcert");
  if (rootCertificate) environment.PGSSLROOTCERT = rootCertificate;
  else delete environment.PGSSLROOTCERT;
  const result = spawnSync(command, args, {
    cwd: resolve(import.meta.dir, ".."),
    env: environment,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || "")
      .replaceAll(environment.PGPASSWORD ?? "", "[redacted]")
      .trim()
      .slice(0, 2_000);
    throw new Error(`RESTORE_QA_TOOL_FAILED_${label}_${result.status ?? "SPAWN"}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function allTableCounts(database: QueryPool): Promise<Array<{ table: string; count: string }>> {
  const tables = await database.query<{ schemaname: string; tablename: string }>(`
    SELECT schemaname, tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename
  `);
  const values = await Promise.all(tables.rows.map(async ({ schemaname, tablename }) => {
    const result = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quoteIdentifier(schemaname)}.${quoteIdentifier(tablename)}`,
    );
    return { table: `${schemaname}.${tablename}`, count: result.rows[0]!.count };
  }));
  return values.sort((left, right) => left.table.localeCompare(right.table));
}

async function migrationLedger(database: QueryPool): Promise<Array<{ filename: string; sha256: string | null }>> {
  const result = await database.query<{ filename: string; sha256: string | null }>(`
    SELECT filename, sha256
    FROM public.nova_schema_migrations
    ORDER BY filename
  `);
  return result.rows;
}

async function extensionInventory(database: QueryPool): Promise<Array<Record<string, unknown>>> {
  const result = await database.query<Record<string, unknown>>(`
    SELECT extension.extname, extension.extversion, namespace.nspname AS schema
    FROM pg_catalog.pg_extension extension
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
    ORDER BY extension.extname
  `);
  return result.rows;
}

async function verifyLedgerMatchesRelease(database: QueryPool): Promise<number> {
  const manifest = JSON.parse(await readFile(resolve(import.meta.dir, "../release-manifest.json"), "utf8")) as {
    migrations?: Array<{ filename?: unknown; sha256?: unknown }>;
  };
  if (!Array.isArray(manifest.migrations)) throw new Error("RESTORE_QA_RELEASE_MANIFEST_INVALID");
  const expected = manifest.migrations.map((migration) => {
    if (typeof migration.filename !== "string" || typeof migration.sha256 !== "string") {
      throw new Error("RESTORE_QA_RELEASE_MANIFEST_INVALID");
    }
    return { filename: migration.filename, sha256: migration.sha256 };
  });
  const actual = await migrationLedger(database);
  const checksumStart = expected.findIndex(({ filename }) => filename === "0076_operator_update_checksums.sql");
  if (checksumStart < 0 || actual.length !== expected.length) {
    throw new Error("RESTORE_QA_MIGRATION_LEDGER_LENGTH_DIFFERS_FROM_RELEASE");
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedMigration = expected[index]!;
    const appliedMigration = actual[index];
    if (!appliedMigration || appliedMigration.filename !== expectedMigration.filename) {
      throw new Error(`RESTORE_QA_MIGRATION_LEDGER_ORDER_DIFFERS_FROM_RELEASE:${expectedMigration.filename}`);
    }
    if (index < checksumStart) {
      if (appliedMigration.sha256 !== null) {
        throw new Error(`RESTORE_QA_UNEXPECTED_LEGACY_MIGRATION_CHECKSUM:${expectedMigration.filename}`);
      }
    } else if (appliedMigration.sha256 !== expectedMigration.sha256) {
      throw new Error(`RESTORE_QA_MIGRATION_CHECKSUM_DIFFERS_FROM_RELEASE:${expectedMigration.filename}`);
    }
  }
  return actual.length;
}

async function policyInventory(database: QueryPool): Promise<Array<Record<string, unknown>>> {
  const result = await database.query<Record<string, unknown>>(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname IN ('nova', 'nova_auth')
    ORDER BY schemaname, tablename, policyname
  `);
  return result.rows;
}

async function sequenceInventory(database: QueryPool): Promise<Array<Record<string, unknown>>> {
  const sequences = await database.query<{ schemaname: string; sequencename: string }>(`
    SELECT schemaname, sequencename
    FROM pg_catalog.pg_sequences
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, sequencename
  `);
  const values = await Promise.all(sequences.rows.map(async ({ schemaname, sequencename }) => {
    const result = await database.query<{ last_value: string; is_called: boolean }>(
      `SELECT last_value::text, is_called FROM ${quoteIdentifier(schemaname)}.${quoteIdentifier(sequencename)}`,
    );
    return { name: `${schemaname}.${sequencename}`, ...result.rows[0] };
  }));
  return values;
}

async function verifyAppRoleAndRls(databaseUrl: URL): Promise<void> {
  const app = new pgModule.Pool({ connectionString: databaseUrl.toString(), max: 1 });
  const client = await app.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT set_config('nova.user_id', $1, true), set_config('nova.organisation_id', $2, true)",
        [fixture.personOne, fixture.orgOne],
      );
      const visiblePeople = await client.query<{ id: string; email: string }>(
        "SELECT id, email FROM nova.people WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[fixture.personOne, fixture.personTwo]],
      );
      if (visiblePeople.rows.length !== 1 || visiblePeople.rows[0]?.id !== fixture.personOne ||
          visiblePeople.rows[0]?.email !== fixture.email) {
        throw new Error("RESTORE_QA_APPLICATION_RLS_TENANT_ISOLATION_FAILED");
      }
      const authState = await client.query<{ email: string; email_verified: boolean; active_session: boolean }>(`
        SELECT users.email, users."emailVerified" AS email_verified,
               sessions."expiresAt" > now() AS active_session
        FROM nova_auth.session sessions
        JOIN nova_auth."user" users ON users.id = sessions."userId"
        WHERE sessions.id = $1 AND sessions.token = $2
      `, [fixture.sessionId, fixture.sessionToken]);
      if (authState.rows.length !== 1 || authState.rows[0]?.email !== fixture.email ||
          authState.rows[0]?.email_verified !== true || authState.rows[0]?.active_session !== true) {
        throw new Error("RESTORE_QA_AUTHENTICATED_SESSION_STATE_MISSING");
      }
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
    await app.end();
  }
}

try {
  console.info(`QA restore rehearsal source is run-scoped: ${sourceUrl.pathname.slice(1)}; target is ${targetName}.`);
  await source.query(`CREATE DATABASE ${targetIdentifier} OWNER nova_migrator TEMPLATE template0 ENCODING 'UTF8'`);
  targetCreated = true;

  const organisationTime = new Date();
  await source.query("INSERT INTO nova.organisations (id, name) VALUES ($1, $2), ($3, $4)", [
    fixture.orgOne, `QA Restore Organisation A ${fixtureId}`,
    fixture.orgTwo, `QA Restore Organisation B ${fixtureId}`,
  ]);
  await source.query(`
    INSERT INTO nova.people (id, organisation_id, email, display_name) VALUES
      ($1, $2, $3, 'QA Restore Person A'), ($4, $5, $6, 'QA Restore Person B')
  `, [fixture.personOne, fixture.orgOne, fixture.email, fixture.personTwo, fixture.orgTwo, `hidden-${fixture.email}`]);
  await source.query("INSERT INTO nova.person_status_periods (person_id, status, effective_at) VALUES ($1, 'active', $2), ($3, 'active', $2)", [
    fixture.personOne, organisationTime, fixture.personTwo,
  ]);
  await source.query("INSERT INTO nova.person_identities (person_id, provider, subject) VALUES ($1, 'better_auth', $2)", [
    fixture.personOne, fixture.authUserId,
  ]);
  await source.query(`
    INSERT INTO nova_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ($1, 'QA Restore Identity', $2, true, $3, $3)
  `, [fixture.authUserId, fixture.email, organisationTime]);
  await source.query(`
    INSERT INTO nova_auth.session (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
    VALUES ($1, $2::timestamptz + interval '1 hour', $3, $2, $2, $4)
  `, [fixture.sessionId, organisationTime, fixture.sessionToken, fixture.authUserId]);
  await source.query(`
    INSERT INTO nova.email_provider_connections (
      id, name, provider, sender_email, credentials_ciphertext, credentials_key_version, is_active
    ) VALUES ($1, $2, 'resend', 'qa-restore@example.test', $3, 1, false)
  `, [fixture.secretConnectionId, `QA restore provider ${fixtureId}`, credentialCiphertext]);
  await source.query("CREATE SCHEMA qa_restore");
  await source.query(`
    CREATE TABLE qa_restore.sequence_probe (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      label text NOT NULL
    )
  `);
  await source.query("INSERT INTO qa_restore.sequence_probe (label) VALUES ('restored sequence state')");
  await source.query("SELECT setval(pg_get_serial_sequence('qa_restore.sequence_probe', 'id'), 41, true)");

  await verifyAppRoleAndRls(sourceAppUrl);
  const expectedLedgerCount = await verifyLedgerMatchesRelease(source);
  const expectedCounts = await allTableCounts(source);
  const expectedPolicies = await policyInventory(source);
  const expectedSequences = await sequenceInventory(source);
  const expectedExtensions = await extensionInventory(source);
  const expectedFingerprint = createHash("sha256").update(JSON.stringify({
    counts: expectedCounts,
    ledger: await migrationLedger(source),
    policies: expectedPolicies,
    sequences: expectedSequences,
  })).digest("hex");
  const expectedCredential = decryptSecret(credentialCiphertext, secretEnvironment);
  if (expectedCredential !== JSON.stringify({ apiKey: fixture.encryptedCredential })) {
    throw new Error("RESTORE_QA_SOURCE_CREDENTIAL_ENCRYPTION_FAILED");
  }

  // The custom-format archive is local to a mode-0700 temp directory in the
  // disposable QA container; it never reaches a host path or shared volume.
  await chmod(workDirectory, 0o700);
  tool("pg-dump", "pg_dump", ["--format=custom", "--no-owner", "--file", dumpPath], sourceUrl);
  const clearDump = await readFile(dumpPath);
  if (clearDump.length < 1024 || clearDump.subarray(0, 5).toString("ascii") !== "PGDMP") {
    throw new Error("RESTORE_QA_PG_DUMP_INVALID");
  }
  tool("pg-restore", "pg_restore", ["--exit-on-error", "--no-owner", "--dbname", targetName, dumpPath], targetUrl);

  target = new pgModule.Pool({ connectionString: targetUrl.toString(), max: 8 });
  const restoredLedgerCount = await verifyLedgerMatchesRelease(target);
  if (restoredLedgerCount !== expectedLedgerCount) throw new Error("RESTORE_QA_MIGRATION_LEDGER_COUNT_CHANGED");
  const actualCounts = await allTableCounts(target);
  const actualPolicies = await policyInventory(target);
  const actualSequences = await sequenceInventory(target);
  const actualExtensions = await extensionInventory(target);
  const actualFingerprint = createHash("sha256").update(JSON.stringify({
    counts: actualCounts,
    ledger: await migrationLedger(target),
    policies: actualPolicies,
    sequences: actualSequences,
  })).digest("hex");
  if (actualFingerprint !== expectedFingerprint ||
      JSON.stringify(actualCounts) !== JSON.stringify(expectedCounts) ||
      JSON.stringify(actualPolicies) !== JSON.stringify(expectedPolicies) ||
      JSON.stringify(actualSequences) !== JSON.stringify(expectedSequences) ||
      JSON.stringify(actualExtensions) !== JSON.stringify(expectedExtensions)) {
    throw new Error("RESTORE_QA_DATABASE_STATE_DIVERGED");
  }
  const btreeGist = actualExtensions.find((extension) => extension.extname === "btree_gist" && extension.schema === "nova");
  if (!btreeGist) throw new Error("RESTORE_QA_REQUIRED_EXTENSION_MISSING");

  await verifyAppRoleAndRls(targetAppUrl);
  const restoredCredential = await target.query<{ credentials_ciphertext: Buffer; credentials_key_version: number }>(`
    SELECT credentials_ciphertext, credentials_key_version
    FROM nova.email_provider_connections
    WHERE id = $1
  `, [fixture.secretConnectionId]);
  const credentialRow = restoredCredential.rows[0];
  if (!credentialRow || credentialRow.credentials_key_version !== 1 ||
      decryptSecret(credentialRow.credentials_ciphertext, secretEnvironment) !== expectedCredential) {
    throw new Error("RESTORE_QA_ENCRYPTED_APPLICATION_SECRET_KEY_CONTINUITY_FAILED");
  }
  let wrongKeyRejected = false;
  try {
    decryptSecret(credentialRow.credentials_ciphertext, {
      NOVA_SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    });
  } catch { wrongKeyRejected = true; }
  if (!wrongKeyRejected) throw new Error("RESTORE_QA_ENCRYPTED_APPLICATION_SECRET_ACCEPTED_WRONG_KEY");
  const sequenceNext = await target.query<{ next_value: string }>(
    "SELECT nextval('qa_restore.sequence_probe_id_seq')::text AS next_value",
  );
  if (sequenceNext.rows[0]?.next_value !== "42") throw new Error("RESTORE_QA_SEQUENCE_POSITION_NOT_PRESERVED");

  const preflightEnvironment = {
    ...process.env,
    MIGRATOR_DATABASE_URL: targetUrl.toString(),
    DATABASE_URL: targetAppUrl.toString(),
    NOVA_APPLICATION_DATABASE_ROLE: "nova_app",
  };
  const preflight = spawnSync(process.execPath, ["scripts/deployment-preflight.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    env: preflightEnvironment,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (preflight.error || preflight.status !== 0) throw new Error("RESTORE_QA_APPLICATION_ROLE_PREFLIGHT_FAILED");

  console.info(`Full isolated PostgreSQL 17 dump/restore passed: ${restoredLedgerCount} canonical migration checksums; ${actualCounts.length} table row counts; ${actualPolicies.length} RLS policies; ${actualSequences.length} sequences; ${actualExtensions.length} extensions; auth session, tenant isolation, provider credential decryption with the original NOVA encryption key, and restricted-role preflight verified.`);
} finally {
  await target?.end().catch(() => undefined);
  if (targetCreated) {
    await source.query(`DROP DATABASE IF EXISTS ${targetIdentifier} WITH (FORCE)`).catch(() => undefined);
  }
  await source.end();
  await rm(workDirectory, { recursive: true, force: true });
}
