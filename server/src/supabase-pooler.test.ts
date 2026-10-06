import { describe, expect, test } from "bun:test";
import {
  assertSupabaseDatabaseUrlBinding,
  resolveSupabasePoolerHost,
  selectSupabasePoolerHost,
  supabasePoolerHostFromConfiguration,
  validateSupabasePoolerHost,
} from "./supabase-pooler";

const pooler = (host: string, poolMode = "transaction", databaseType = "PRIMARY") => ({
  database_type: databaseType,
  pool_mode: poolMode,
  db_host: host,
  db_port: 6543,
  db_name: "postgres",
  connection_string: `postgresql://postgres.project:secret@${host}:6543/postgres`,
});

describe("Supabase transaction pooler discovery", () => {
  test("uses the configured cluster index instead of guessing from the region", () => {
    expect(supabasePoolerHostFromConfiguration([
      pooler("aws-0-ap-south-1.pooler.supabase.com", "session"),
      pooler("aws-3-ap-south-1.pooler.supabase.com"),
      pooler("aws-8-ap-south-1.pooler.supabase.com", "transaction", "READ_REPLICA"),
    ])).toBe("aws-3-ap-south-1.pooler.supabase.com");
  });

  test("accepts a safe configured host and rejects arbitrary hosts", () => {
    expect(validateSupabasePoolerHost("aws-12-eu-west-2.pooler.supabase.com"))
      .toBe("aws-12-eu-west-2.pooler.supabase.com");
    expect(() => validateSupabasePoolerHost("attacker.example"))
      .toThrow("SUPABASE_POOLER_HOST_INVALID");
  });

  test("uses only the pooler host resolved from the selected project", () => {
    expect(selectSupabasePoolerHost({
      verifiedHost: "aws-3-ap-south-1.pooler.supabase.com",
      explicitHost: "aws-3-ap-south-1.pooler.supabase.com",
    })).toBe("aws-3-ap-south-1.pooler.supabase.com");
    expect(() => selectSupabasePoolerHost({
      verifiedHost: "aws-3-ap-south-1.pooler.supabase.com",
      explicitHost: "aws-0-ap-south-1.pooler.supabase.com",
    })).toThrow("SUPABASE_POOLER_HOST_PROJECT_MISMATCH");
  });

  test("rejects malformed, mismatched, and absent transaction pooler config", () => {
    expect(() => supabasePoolerHostFromConfiguration({})).toThrow("SUPABASE_POOLER_CONFIGURATION_INVALID");
    expect(() => supabasePoolerHostFromConfiguration([pooler("aws-0-us-east-1.pooler.supabase.com", "session")]))
      .toThrow("SUPABASE_TRANSACTION_POOLER_NOT_FOUND");
    expect(() => supabasePoolerHostFromConfiguration([{
      ...pooler("aws-0-us-east-1.pooler.supabase.com"),
      connection_string: "postgresql://postgres:secret@attacker.example:6543/postgres",
    }])).toThrow("SUPABASE_TRANSACTION_POOLER_NOT_FOUND");
  });

  test("fetches only the project's read-only pooler configuration", async () => {
    let requested = "";
    const host = await resolveSupabasePoolerHost("abcdefghijklmnopqrst", "token", async (input, init) => {
      requested = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
      expect(init?.method).toBeUndefined();
      return new Response(JSON.stringify([pooler("aws-2-us-east-1.pooler.supabase.com")]), { status: 200 });
    });
    expect(requested).toBe("https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/database/pooler");
    expect(host).toBe("aws-2-us-east-1.pooler.supabase.com");
  });

  test("does not leak API error bodies or credentials", async () => {
    await expect(resolveSupabasePoolerHost("abcdefghijklmnopqrst", "token", async () =>
      new Response("sensitive server body", { status: 403 }),
    )).rejects.toThrow("SUPABASE_POOLER_CONFIG_LOOKUP_FAILED_403");
  });
});

describe("Supabase database project binding", () => {
  const projectRef = "abcdefghijklmnopqrst";

  test("accepts an app-role pooler URL bound to the selected project", () => {
    expect(() => assertSupabaseDatabaseUrlBinding(
      `postgresql://nova_app.${projectRef}:private@aws-2-us-east-1.pooler.supabase.com:6543/postgres`,
      projectRef,
    )).not.toThrow();
  });

  test("rejects a pooler URL bound to a different project or role", () => {
    expect(() => assertSupabaseDatabaseUrlBinding(
      "postgresql://nova_app.otherproject:private@aws-2-us-east-1.pooler.supabase.com:6543/postgres",
      projectRef,
    )).toThrow("SUPABASE_DATABASE_URL_PROJECT_MISMATCH");
    expect(() => assertSupabaseDatabaseUrlBinding(
      `postgresql://postgres.${projectRef}:private@aws-2-us-east-1.pooler.supabase.com:6543/postgres`,
      projectRef,
    )).toThrow("SUPABASE_DATABASE_URL_PROJECT_MISMATCH");
  });

  test("accepts direct database hosts and rejects mismatched or unidentifiable targets", () => {
    expect(() => assertSupabaseDatabaseUrlBinding(
      `postgresql://nova_app:private@db.${projectRef}.supabase.co:5432/postgres`,
      projectRef,
    )).not.toThrow();
    expect(() => assertSupabaseDatabaseUrlBinding(
      "postgresql://nova_app:private@db.zyxwvutsrqponmlkjihg.supabase.co:5432/postgres",
      projectRef,
    )).toThrow("SUPABASE_DATABASE_URL_PROJECT_MISMATCH");
    expect(() => assertSupabaseDatabaseUrlBinding(
      "postgresql://nova_app:private@database.example.com:5432/postgres",
      projectRef,
    )).toThrow("SUPABASE_DATABASE_URL_PROJECT_UNVERIFIABLE");
  });
});
