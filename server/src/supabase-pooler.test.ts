import { describe, expect, test } from "bun:test";
import {
  configuredSupabasePoolerHost,
  resolveSupabasePoolerHost,
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

  test("does not carry a saved pooler host across an explicit project change", () => {
    expect(configuredSupabasePoolerHost({
      projectRef: "newprojectref00000001",
      environmentProjectRef: "oldprojectref00000001",
      environmentHost: "aws-0-ap-south-1.pooler.supabase.com",
      savedProjectRef: "oldprojectref00000001",
      savedHost: "aws-0-ap-south-1.pooler.supabase.com",
    })).toBeUndefined();
    expect(configuredSupabasePoolerHost({
      projectRef: "newprojectref00000001",
      environmentProjectRef: "newprojectref00000001",
      environmentHost: "aws-0-ap-south-1.pooler.supabase.com",
      savedProjectRef: "oldprojectref00000001",
      savedHost: "aws-0-ap-south-1.pooler.supabase.com",
    })).toBeUndefined();
    expect(configuredSupabasePoolerHost({
      projectRef: "oldprojectref00000001",
      environmentProjectRef: "oldprojectref00000001",
      environmentHost: "aws-2-ap-south-1.pooler.supabase.com",
      savedProjectRef: "oldprojectref00000001",
      savedHost: "aws-0-ap-south-1.pooler.supabase.com",
    })).toBe("aws-2-ap-south-1.pooler.supabase.com");
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
