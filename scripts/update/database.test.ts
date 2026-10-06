import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPostgresUpdate,
  applySupabaseUpdate,
  loadCanonicalMigrations,
  planPostgresUpdate,
  planSupabaseUpdate,
  postgresTargetLabel,
  postgresUrlsReferToSameDatabase,
  reconcileMigrationLedger,
  sha256,
  supabaseUrlBelongsToProject,
  type MigrationHashManifest,
} from "./database.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function migrationFixture() {
  const directory = await mkdtemp(join(tmpdir(), "nova-update-migrations-"));
  directories.push(directory);
  const source1 = "SELECT 'first';\n";
  const source2 = "SELECT 'second';\n";
  await writeFile(join(directory, "0001_initial.sql"), source1);
  await writeFile(join(directory, "0002_feature.sql"), source2);
  const baselineManifest: MigrationHashManifest = {
    "0001_initial.sql": sha256(source1),
  };
  const targetManifest: MigrationHashManifest = {
    ...baselineManifest,
    "0002_feature.sql": sha256(source2),
  };
  return { directory, baselineManifest, targetManifest };
}

describe("database update migration integrity", () => {
  test("migration checksums are stable across checkout line endings", () => {
    expect(sha256("SELECT 1;\nSELECT 2;\n")).toBe(sha256("SELECT 1;\r\nSELECT 2;\r\n"));
    expect(sha256("SELECT 1;\nSELECT 2;\n")).toBe(sha256(new TextEncoder().encode("SELECT 1;\r\nSELECT 2;\r\n")));
  });

  test("checks the pinned hash and requires the applied ledger to be a known prefix", async () => {
    const fixture = await migrationFixture();
    const migrations = await loadCanonicalMigrations(fixture.targetManifest, fixture.directory);

    expect(migrations).toHaveLength(2);
    expect(() => reconcileMigrationLedger(
      ["0002_feature.sql"],
      fixture.baselineManifest,
      fixture.targetManifest,
      "test database",
      migrations,
    )).toThrow("DATABASE_MIGRATION_CHECKSUM_MISSING:0002_feature.sql");
    expect(() => reconcileMigrationLedger(
      [
        { filename: "0001_initial.sql", sha256: null },
        { filename: "0002_feature.sql", sha256: null },
      ],
      fixture.baselineManifest,
      fixture.targetManifest,
      "test database",
      migrations,
    )).toThrow("DATABASE_MIGRATION_CHECKSUM_MISSING:0002_feature.sql");
    expect(reconcileMigrationLedger(
      [
        { filename: "0001_initial.sql", sha256: null },
        { filename: "0002_feature.sql", sha256: null },
      ],
      fixture.baselineManifest,
      fixture.targetManifest,
      "test database",
      migrations,
      { "0002_feature.sql": fixture.targetManifest["0002_feature.sql"] },
    ).applied).toEqual(["0001_initial.sql", "0002_feature.sql"]);
    expect(() => reconcileMigrationLedger(
      [{ filename: "0001_initial.sql", sha256: "0".repeat(64) }],
      fixture.baselineManifest,
      fixture.targetManifest,
      "test database",
      migrations,
    )).toThrow("DATABASE_MIGRATION_CHECKSUM_MISMATCH:0001_initial.sql");

    const tampered = { ...fixture.targetManifest, "0002_feature.sql": "0".repeat(64) };
    await expect(loadCanonicalMigrations(tampered, fixture.directory))
      .rejects.toThrow("TARGET_MIGRATION_HASH_MISMATCH:0002_feature.sql");
  });

  test("rejects historical hash changes while accepting the completed target ledger", async () => {
    const fixture = await migrationFixture();
    const migrations = await loadCanonicalMigrations(fixture.targetManifest, fixture.directory);
    const alteredBaseline = { ...fixture.baselineManifest, "0001_initial.sql": "a".repeat(64) };

    expect(() => reconcileMigrationLedger(
      ["0001_initial.sql"], alteredBaseline, fixture.targetManifest, "test database", migrations,
    )).toThrow("HISTORICAL_MIGRATION_CHANGED:0001_initial.sql");
    const completedTarget = reconcileMigrationLedger(
      [
        { filename: "0001_initial.sql", sha256: null },
        { filename: "0002_feature.sql", sha256: fixture.targetManifest["0002_feature.sql"] },
      ],
      fixture.baselineManifest,
      fixture.targetManifest,
      "test database",
      migrations,
    );
    expect(completedTarget.pending).toHaveLength(0);
  });

  test("accepts a known contiguous ledger prefix and plans migrations missing from the baseline", async () => {
    const fixture = await migrationFixture();
    const migrations = await loadCanonicalMigrations(fixture.targetManifest, fixture.directory);

    const plan = reconcileMigrationLedger(
      ["0001_initial.sql"],
      fixture.targetManifest,
      fixture.targetManifest,
      "test database",
      migrations,
    );
    expect(plan.applied).toEqual(["0001_initial.sql"]);
    expect(plan.pending.map(({ filename }) => filename)).toEqual(["0002_feature.sql"]);
  });

  test("requires the checksum column migration itself to carry a persisted digest", () => {
    const firstHash = "a".repeat(64);
    const checksumHash = "b".repeat(64);
    const target = {
      "0001_initial.sql": firstHash,
      "0076_operator_update_checksums.sql": checksumHash,
    };
    expect(() => reconcileMigrationLedger(
      [
        { filename: "0001_initial.sql", sha256: null },
        { filename: "0076_operator_update_checksums.sql", sha256: null },
      ],
      { "0001_initial.sql": firstHash },
      target,
      "test database",
      [
        { filename: "0001_initial.sql", sha256: firstHash, source: "" },
        { filename: "0076_operator_update_checksums.sql", sha256: checksumHash, source: "" },
      ],
    )).toThrow("MIGRATION_CHECKSUM_COLUMN_MISSING");
  });
});

describe("Supabase database update adapter", () => {
  test("binds the application URL to the selected Supabase project", () => {
    const ref = "abcdefghijklmnopqrst";
    expect(supabaseUrlBelongsToProject(
      `postgresql://nova_app.${ref}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, ref,
    )).toBe(true);
    expect(supabaseUrlBelongsToProject(
      `postgresql://nova_app:secret@db.${ref}.supabase.co:5432/postgres`, ref,
    )).toBe(true);
    expect(supabaseUrlBelongsToProject(
      "postgresql://nova_app.otherproject:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres", ref,
    )).toBe(false);
    expect(supabaseUrlBelongsToProject(
      `postgresql://nova_app.${ref}:secret@unrelated.example.com:6543/postgres`, ref,
    )).toBe(false);
    expect(supabaseUrlBelongsToProject(
      `postgresql://nova_app.${ref}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, ref,
    )).toBe(true);
  });

  test("requires the exact project ref before making a request", async () => {
    const fixture = await migrationFixture();
    let requests = 0;
    const request = (async () => {
      requests += 1;
      return Response.json([{ ledger_exists: true, has_sha256: false }]);
    }) as unknown as typeof fetch;

    await expect(planSupabaseUpdate({
      projectRef: "abcdefghijklmnopqrst",
      accessToken: "secret-token",
      confirmation: "wrong-project",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      migrationDirectory: fixture.directory,
      request,
    })).rejects.toThrow("SUPABASE_PROJECT_REF_CONFIRMATION_MISMATCH");
    expect(requests).toBe(0);
  });

  test("plans from the NOVA ledger and wraps each migration with a project lock and ledger guard", async () => {
    const fixture = await migrationFixture();
    let ledger = ["0001_initial.sql"];
    const events: string[] = [];
    const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/database/query")) {
        const query = (JSON.parse(String(init?.body)) as { query: string }).query;
        if (query.includes("to_regclass")) return Response.json([{ ledger_exists: true, has_sha256: false }]);
        return Response.json(ledger.map((filename) => ({ filename })));
      }
      if (url.endsWith("/database/migrations")) {
        events.push("request");
        const body = JSON.parse(String(init?.body)) as { query: string; name: string };
        expect(body.name).toBe("0002_feature");
        expect(body.query).toContain("pg_try_advisory_xact_lock");
        expect(body.query).toContain("NOVA_MIGRATION_ALREADY_APPLIED");
        expect(body.query).toContain("INSERT INTO public.nova_schema_migrations");
        ledger = [...ledger, "0002_feature.sql"];
        return Response.json({}, { status: 200 });
      }
      throw new Error("unexpected endpoint");
    }) as typeof fetch;

    const options = {
      projectRef: "abcdefghijklmnopqrst",
      accessToken: "secret-token",
      confirmation: "abcdefghijklmnopqrst",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      migrationDirectory: fixture.directory,
      request,
      onMigrationStarting: (filename) => { events.push(`starting:${filename}`); },
      onMigrationApplied: (filename) => { events.push(`applied:${filename}`); },
    };

    const plan = await planSupabaseUpdate(options);
    expect(plan.pending.map(({ filename }) => filename)).toEqual(["0002_feature.sql"]);
    const result = await applySupabaseUpdate(options);
    expect(result.applied).toEqual(["0002_feature.sql"]);
    expect(ledger).toContain("0002_feature.sql");
    expect(events).toEqual([
      "starting:0002_feature.sql",
      "request",
      "applied:0002_feature.sql",
    ]);
  });

  test("does not blindly retry when the migration request fails without a ledger marker", async () => {
    const fixture = await migrationFixture();
    const ledger = ["0001_initial.sql"];
    let migrationCalls = 0;
    const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/database/query")) {
        const query = (JSON.parse(String(init?.body)) as { query: string }).query;
        if (query.includes("to_regclass")) return Response.json([{ ledger_exists: true, has_sha256: false }]);
        return Response.json(ledger.map((filename) => ({ filename })));
      }
      migrationCalls += 1;
      return new Response("private database diagnostic", { status: 500 });
    }) as typeof fetch;

    await expect(applySupabaseUpdate({
      projectRef: "abcdefghijklmnopqrst",
      accessToken: "secret-token",
      confirmation: "abcdefghijklmnopqrst",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      migrationDirectory: fixture.directory,
      request,
    })).rejects.toThrow("SUPABASE_MIGRATION_OUTCOME_UNKNOWN:0002_feature.sql");
    expect(migrationCalls).toBe(1);
  });

  test("backfills only journal-verified target rows after the checksum column exists", async () => {
    const fixture = await migrationFixture();
    const ledger = new Map<string, string | null>([
      ["0001_initial.sql", null],
      ["0002_feature.sql", null],
    ]);
    const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/database/query")) return Response.json({});
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      if (query.includes("to_regclass")) {
        return Response.json([{ ledger_exists: true, has_sha256: true }]);
      }
      if (query.includes("information_schema.columns")) {
        return Response.json([{ has_sha256: true }]);
      }
      if (query.startsWith("UPDATE public.nova_schema_migrations")) {
        expect(query).toContain("0002_feature.sql");
        expect(query).not.toContain("0001_initial.sql");
        ledger.set("0002_feature.sql", fixture.targetManifest["0002_feature.sql"]);
        return Response.json({});
      }
      return Response.json([...ledger].map(([filename, sha256]) => ({ filename, sha256 })));
    }) as typeof fetch;

    const result = await applySupabaseUpdate({
      projectRef: "abcdefghijklmnopqrst",
      accessToken: "secret-token",
      confirmation: "abcdefghijklmnopqrst",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      verifiedMigrationHashes: {
        "0002_feature.sql": fixture.targetManifest["0002_feature.sql"],
      },
      migrationDirectory: fixture.directory,
      request,
    });

    expect(result.applied).toEqual([]);
    expect(ledger.get("0001_initial.sql")).toBeNull();
    expect(ledger.get("0002_feature.sql")).toBe(fixture.targetManifest["0002_feature.sql"]);
  });
});

describe("direct PostgreSQL update adapter", () => {
  test("matches restricted and migration URLs to the same database endpoint", () => {
    expect(postgresUrlsReferToSameDatabase(
      "postgresql://nova_migrator:secret@db.example.com:5432/nova",
      "postgresql://nova_app:secret@db.example.com:5432/nova",
    )).toBe(true);
    expect(postgresUrlsReferToSameDatabase(
      "postgresql://nova_migrator:secret@db.example.com:5432/nova",
      "postgresql://nova_app:secret@db.example.com:6433/nova",
    )).toBe(false);
    expect(postgresUrlsReferToSameDatabase(
      "postgresql://nova_migrator.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      "postgresql://nova_app.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    )).toBe(true);
    expect(postgresUrlsReferToSameDatabase(
      "postgresql://nova_migrator.abcdefghijklmnopqrst:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
      "postgresql://nova_app.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    )).toBe(true);
    expect(postgresUrlsReferToSameDatabase(
      "postgresql://nova_migrator.aaaaaaaaaaaaaaaaaaaa:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      "postgresql://nova_app.bbbbbbbbbbbbbbbbbbbb:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    )).toBe(false);
    expect(postgresUrlsReferToSameDatabase(
      "postgresql://nova_migrator:secret@db.example.com:5432/nova",
      "postgresql://nova_app:secret@other.example.com:5432/nova",
    )).toBe(false);
  });

  test("rejects Supabase transaction-pooler connections before querying or migrating", async () => {
    const fixture = await migrationFixture();
    const url = "postgresql://nova_migrator:private@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
    let queries = 0;
    let released = false;
    const client = {
      async query() {
        queries += 1;
        return { rows: [] };
      },
      release() { released = true; },
    };

    await expect(planPostgresUpdate({
      databaseUrl: url,
      confirmation: "PostgreSQL aws-0-us-east-1.pooler.supabase.com:6543/postgres as nova_migrator",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      migrationDirectory: fixture.directory,
      createPool: () => ({ connect: async () => client, end: async () => {} }) as never,
    })).rejects.toThrow("POSTGRES_TRANSACTION_POOLER_UNSUPPORTED");
    expect(queries).toBe(0);
    expect(released).toBe(true);
  });

  test("uses the existing advisory-lock key and transaction for each canonical file", async () => {
    const fixture = await migrationFixture();
    const ledger = new Set(["0001_initial.sql"]);
    const checksums = new Map<string, string>();
    let checksumColumnExists = false;
    const observed: string[] = [];
    const client = {
      async query(query: string, values?: unknown[]) {
        observed.push(query.trim().replace(/\s+/g, " "));
        if (query.includes("current_database()")) {
          return { rows: [{
            current_database: "nova",
            current_user: "nova_migrator",
            transaction_read_only: "off",
            ledger_exists: true,
          }] };
        }
        if (query.includes("to_regclass('public.nova_schema_migrations')")) {
          return { rows: [{ ledger_exists: true, has_sha256: checksumColumnExists }] };
        }
        if (query.includes("information_schema.columns")) {
          return { rows: [{ has_sha256: checksumColumnExists }] };
        }
        if (query.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
        if (query.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
        if (query.includes("FROM public.nova_schema_migrations ORDER BY filename")) {
          return { rows: [...ledger].sort().map((filename) => ({ filename, sha256: checksums.get(filename) ?? null })) };
        }
        if (query.includes("SELECT 'second'")) {
          // Represents the migration that adds the nullable checksum column.
          checksumColumnExists = true;
          return { rows: [] };
        }
        if (query.startsWith("INSERT INTO public.nova_schema_migrations (filename, sha256)")) {
          ledger.add(String(values?.[0]));
          checksums.set(String(values?.[0]), String(values?.[1]));
          return { rows: [] };
        }
        if (query.startsWith("INSERT INTO public.nova_schema_migrations")) {
          ledger.add(String(values?.[0]));
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const pool = {
      async connect() { return client; },
      async end() {},
    };

    const result = await applyPostgresUpdate({
      databaseUrl: "postgresql://nova_migrator:private@localhost:5432/nova",
      confirmation: "PostgreSQL localhost:5432/nova as nova_migrator",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      migrationDirectory: fixture.directory,
      createPool: () => pool as never,
    });

    expect(result.applied).toEqual(["0002_feature.sql"]);
    expect(ledger.has("0002_feature.sql")).toBe(true);
    expect(checksums.get("0002_feature.sql")).toBe(fixture.targetManifest["0002_feature.sql"]);
    expect(observed.some((query) => query.includes("pg_try_advisory_lock(hashtextextended($1, 0))"))).toBe(true);
    expect(observed).toContain("BEGIN");
    expect(observed).toContain("COMMIT");
  });

  test("backfills only journal-verified target rows and preserves baseline NULLs", async () => {
    const fixture = await migrationFixture();
    const ledger = new Map<string, string | null>([
      ["0001_initial.sql", null],
      ["0002_feature.sql", null],
    ]);
    const client = {
      async query(query: string, values?: unknown[]) {
        if (query.includes("current_database()")) {
          return { rows: [{
            current_database: "nova",
            current_user: "nova_migrator",
            transaction_read_only: "off",
            ledger_exists: true,
          }] };
        }
        if (query.includes("to_regclass('public.nova_schema_migrations')")) {
          return { rows: [{ ledger_exists: true, has_sha256: true }] };
        }
        if (query.includes("information_schema.columns")) return { rows: [{ has_sha256: true }] };
        if (query.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
        if (query.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
        if (query.includes("FROM public.nova_schema_migrations ORDER BY filename")) {
          return { rows: [...ledger].map(([filename, sha256]) => ({ filename, sha256 })) };
        }
        if (query.startsWith("UPDATE public.nova_schema_migrations SET sha256")) {
          ledger.set(String(values?.[0]), String(values?.[1]));
          return { rows: [] };
        }
        if (query.startsWith("SELECT sha256 FROM public.nova_schema_migrations")) {
          return { rows: [{ sha256: ledger.get(String(values?.[0])) ?? null }] };
        }
        return { rows: [] };
      },
      release() {},
    };

    const result = await applyPostgresUpdate({
      databaseUrl: "postgresql://nova_migrator:private@localhost:5432/nova",
      confirmation: "PostgreSQL localhost:5432/nova as nova_migrator",
      targetManifest: fixture.targetManifest,
      baselineManifest: fixture.baselineManifest,
      verifiedMigrationHashes: {
        "0002_feature.sql": fixture.targetManifest["0002_feature.sql"],
      },
      migrationDirectory: fixture.directory,
      createPool: () => ({ connect: async () => client, end: async () => {} }) as never,
    });

    expect(result.applied).toEqual([]);
    expect(ledger.get("0001_initial.sql")).toBeNull();
    expect(ledger.get("0002_feature.sql")).toBe(fixture.targetManifest["0002_feature.sql"]);
  });

  test("renders a safe target label without credentials", () => {
    expect(postgresTargetLabel("postgres://migrator:super-secret@db.example.test:5432/nova?sslmode=require"))
      .toBe("PostgreSQL db.example.test:5432/nova as migrator");
  });
});
