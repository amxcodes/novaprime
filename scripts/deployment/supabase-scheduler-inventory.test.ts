import { expect, test } from "bun:test";
import { inspectSupabaseCronInventory } from "./supabase-scheduler-inventory.ts";

const projectRef = "abcdefghijklmnopqrst";
const environment = {
  DATABASE_URL: `postgresql://nova_app.${projectRef}:app-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  MIGRATOR_DATABASE_URL: `postgresql://postgres:migrator-password@db.${projectRef}.supabase.co:5432/postgres`,
  NOVA_SUPABASE_PROJECT_REF: projectRef,
};

test("Supabase Cron inventory pins the owner URL to the app DB and uses a read-only transaction", async () => {
  const statements: string[] = [];
  let connectionString = "";
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("to_regclass('cron.job')")) return { rows: [{ available: true }] };
      if (sql.includes("FROM cron.job")) return { rows: [
        { id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true },
        { id: "13", name: "custom-nova-tick", schedule: "*/2 * * * *", active: false },
      ] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    end: async () => undefined,
  };
  const result = await inspectSupabaseCronInventory(environment, {
    connect: async (url) => { connectionString = url; return pool as never; },
  });
  expect(result).toEqual({
    state: "verified",
    completeness: "project-scoped",
    triggers: [
      { id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true },
      { id: "13", name: "custom-nova-tick", schedule: "*/2 * * * *", active: false },
    ],
  });
  expect(connectionString).toBe(environment.MIGRATOR_DATABASE_URL);
  expect(statements[0]).toBe("BEGIN TRANSACTION READ ONLY");
  expect(statements.some((sql) => /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql))).toBe(false);
  expect(statements.at(-1)).toBe("COMMIT");
  expect(statements.find((sql) => sql.includes("FROM cron.job"))).not.toMatch(/SELECT[\s\S]+,\s*command\s+FROM/i);
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
    detail: "MIGRATOR_DATABASE_URL_REQUIRED_FOR_READ_ONLY_CRON_INVENTORY",
  });
});
