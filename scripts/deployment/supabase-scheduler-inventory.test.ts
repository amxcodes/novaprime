import { expect, test } from "bun:test";
import { inspectSupabaseCronInventory } from "./supabase-scheduler-inventory.ts";

const projectRef = "abcdefghijklmnopqrst";
const environment = {
  DATABASE_URL: `postgresql://nova_app.${projectRef}:app-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  MIGRATOR_DATABASE_URL: `postgresql://postgres:migrator-password@db.${projectRef}.supabase.co:5432/postgres`,
  NOVA_SUPABASE_PROJECT_REF: projectRef,
};
const migrations = [
  { filename: "0001_people_identity.sql", sha256: "a".repeat(64) },
  { filename: "0002_authentication_bootstrap.sql", sha256: "b".repeat(64) },
];

function mockConnect(
  statements: string[],
  migrationRows: Array<{ filename: string; sha256: string | null }>,
  options: { cronInstalled?: boolean; ledgerInstalled?: boolean; checksums?: boolean; cronRows?: unknown[] } = {},
) {
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("to_regclass('cron.job')")) return { rows: [{ available: options.cronInstalled ?? true }] };
      if (sql.includes("FROM cron.job")) return { rows: options.cronRows ?? [
        { id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true },
        { id: "13", name: "custom-nova-tick", schedule: "*/2 * * * *", active: false },
      ] };
      if (sql.includes("to_regclass('public.nova_schema_migrations')")) return { rows: [{ available: options.ledgerInstalled ?? true }] };
      if (sql.includes("information_schema.columns")) return { rows: [{ available: options.checksums ?? true }] };
      if (sql.includes("FROM public.nova_schema_migrations")) return { rows: migrationRows };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client, end: async () => undefined };
  return { connect: async () => pool as never };
}

test("Supabase Cron and migration inventory are database-pinned and read-only", async () => {
  const statements: string[] = [];
  let connectionString = "";
  const migrationRows = migrations.map(({ filename, sha256 }) => ({ filename, sha256 }));
  const result = await inspectSupabaseCronInventory(environment, {
    ...mockConnect(statements, migrationRows),
    connect: async (url) => {
      connectionString = url;
      return await mockConnect(statements, migrationRows).connect();
    },
    expectedMigrations: migrations,
  });
  expect(result).toEqual({
    state: "verified",
    completeness: "project-scoped",
    triggers: [
      { id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true },
      { id: "13", name: "custom-nova-tick", schedule: "*/2 * * * *", active: false },
    ],
    migrationInventory: {
      state: "current", appliedCount: 2, migrationHead: migrations[1]!.filename,
      expectedHead: migrations[1]!.filename, checksumsVerified: true,
    },
  });
  expect(connectionString).toBe(environment.MIGRATOR_DATABASE_URL);
  expect(statements[0]).toBe("BEGIN TRANSACTION READ ONLY");
  expect(statements.some((sql) => /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql))).toBe(false);
  expect(statements.at(-1)).toBe("COMMIT");
  expect(statements.find((sql) => sql.includes("FROM cron.job"))).not.toMatch(/SELECT[\s\S]+,\s*command\s+FROM/i);
});

test("migration inventory distinguishes an updateable prefix, divergence, unknown newer rows, and missing checksums", async () => {
  const scenarios = [
    { name: "behind", rows: [migrations[0]!], checksums: true, state: "behind" },
    { name: "checksum divergence", rows: [{ ...migrations[0]!, sha256: "c".repeat(64) }], checksums: true, state: "diverged" },
    { name: "unknown migration", rows: [{ filename: "0003_customer_extension.sql", sha256: "c".repeat(64) }], checksums: true, state: "ahead" },
    { name: "missing checksums", rows: [{ filename: migrations[0]!.filename, sha256: null }], checksums: false, state: "unverified" },
  ] as const;
  for (const scenario of scenarios) {
    const result = await inspectSupabaseCronInventory(environment, {
      ...mockConnect([], scenario.rows, { cronInstalled: false, checksums: scenario.checksums }),
      expectedMigrations: migrations,
    });
    expect(result.migrationInventory.state).toBe(scenario.state);
  }
});

test("remote migration inventory uses the verified local release manifest by default", async () => {
  const result = await inspectSupabaseCronInventory(environment, {
    ...mockConnect([], [], { cronInstalled: false }),
  });
  expect(result.migrationInventory.state).toBe("behind");
  expect(result.migrationInventory.appliedCount).toBe(0);
  expect(result.migrationInventory.expectedHead).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  expect(result.migrationInventory.checksumsVerified).toBe(true);
});

test("scheduler inventory refuses to inspect a migration URL for another database", async () => {
  let connected = false;
  const result = await inspectSupabaseCronInventory({
    ...environment,
    MIGRATOR_DATABASE_URL: "postgresql://postgres:secret@db.zbcdefghijklmnopqrst.supabase.co:5432/postgres",
  }, {
    connect: async () => { connected = true; throw new Error("must not connect"); },
  });
  expect(result).toEqual({
    state: "unavailable",
    completeness: "not-inspected",
    triggers: [],
    migrationInventory: {
      state: "unavailable", appliedCount: null, migrationHead: null, expectedHead: null,
      checksumsVerified: false, detail: "MIGRATOR_DATABASE_TARGET_MISMATCH",
    },
    detail: "MIGRATOR_DATABASE_TARGET_MISMATCH",
  });
  expect(connected).toBe(false);
});

test("scheduler inventory requires the owner connection rather than widening app permissions", async () => {
  const result = await inspectSupabaseCronInventory({ DATABASE_URL: environment.DATABASE_URL });
  expect(result).toEqual({
    state: "target-required",
    completeness: "not-inspected",
    triggers: [],
    migrationInventory: {
      state: "target-required", appliedCount: null, migrationHead: null, expectedHead: null,
      checksumsVerified: false, detail: "MIGRATOR_DATABASE_URL_REQUIRED_FOR_MIGRATION_INVENTORY",
    },
    detail: "MIGRATOR_DATABASE_URL_REQUIRED_FOR_READ_ONLY_CRON_INVENTORY",
  });
});
