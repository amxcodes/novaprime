import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

describe("deployment assistant rendered flow", () => {
  test("shows where deployment parts are applied and gates Supabase Cron on a successful live probe", () => {
    const repositoryRoot = resolve(import.meta.dir, "..");
    const result = spawnSync("bun", ["--no-env-file", "scripts/deployment-ui-smoke.ts"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS: seven stages, every allowed provider/scheduler pairing");
  });
});
