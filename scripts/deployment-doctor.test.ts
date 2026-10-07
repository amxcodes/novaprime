import { describe, expect, test } from "bun:test";
import {
  diagnoseUpdateAttempt,
  diagnosePreflight,
  normalizeApiOrigin,
  parseDoctorArguments,
  probeApi,
  runDeploymentDoctor,
} from "./deployment-doctor.ts";
import { newUpdateJournal, updateTargetFingerprint } from "./update/state.ts";

describe("deployment doctor", () => {
  test("only accepts an HTTPS origin or local HTTP origin, with no path or credentials", () => {
    expect(normalizeApiOrigin("https://nova.example/" )).toBe("https://nova.example");
    expect(normalizeApiOrigin("http://localhost:3001")).toBe("http://localhost:3001");
    expect(() => normalizeApiOrigin("http://nova.example")).toThrow("DOCTOR_API_ORIGIN_INVALID");
    expect(() => normalizeApiOrigin("https://user:secret@nova.example")).toThrow("DOCTOR_API_ORIGIN_INVALID");
    expect(() => normalizeApiOrigin("https://nova.example/nested")).toThrow("DOCTOR_API_ORIGIN_INVALID");
  });

  test("reports schema readiness and makes missing ledger verification explicit", () => {
    expect(diagnosePreflight({
      code: 0,
      stdout: JSON.stringify({ status: "ready", latestMigration: "0079_latest.sql" }),
      stderr: "",
    })).toMatchObject({ status: "pass", detail: expect.stringContaining("0079_latest.sql") });
    expect(diagnosePreflight({
      code: 2,
      stdout: JSON.stringify({ status: "migration_verification_required" }),
      stderr: "",
    })).toMatchObject({ status: "warning", repair: expect.stringContaining("MIGRATOR_DATABASE_URL") });
  });

  test("maps database target and password errors to safe repair guidance", () => {
    expect(diagnosePreflight({ code: 1, stdout: "", stderr: "SUPABASE_DATABASE_URL_PROJECT_MISMATCH" }))
      .toMatchObject({ status: "fail", repair: expect.stringContaining("exact ref") });
    expect(diagnosePreflight({ code: 1, stdout: "", stderr: "password authentication failed 28P01" }))
      .toMatchObject({ status: "fail", repair: expect.stringContaining("rotate-app-role-password") });
    const safe = diagnosePreflight({ code: 1, stdout: "", stderr: "DATABASE_URL=postgres://secret:password@host" });
    expect(safe.detail).not.toContain("password");
    expect(safe.detail).not.toContain("host");
    expect(diagnosePreflight({ code: 1, stdout: "", stderr: "NOVA_MIGRATION_LEDGER_NOT_CURRENT_0078" }))
      .toMatchObject({ status: "fail", repair: expect.stringContaining("pinned updater") });
  });

  test("surfaces an interrupted update's pinned database and safe resume path", () => {
    const journal = newUpdateJournal({
      repoRoot: process.cwd(),
      originalHead: "a".repeat(40),
      release: { tag: "v0.2.0", version: "0.2.0", commit: "b".repeat(40) },
      candidate: { branch: "nova/update/v0.2.0", path: `${process.cwd()}/candidate`, expectedHead: "c".repeat(40) },
    });
    const label = "Supabase project abcdefghijklmnopqrst";
    journal.phase = "applying-database";
    journal.database = { kind: "supabase", label, targetFingerprint: updateTargetFingerprint(label) };
    journal.appliedMigrations = [{ filename: "0078_example.sql", sha256: "d".repeat(64) }];
    journal.inFlightMigration = { filename: "0079_example.sql", sha256: "e".repeat(64) };

    expect(diagnoseUpdateAttempt(journal)).toMatchObject({
      status: "warning",
      detail: expect.stringContaining(label),
      repair: expect.stringContaining("select exactly Supabase project abcdefghijklmnopqrst"),
    });
  });

  test("probes only health and readiness and sends no auth or database credentials", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const results = await probeApi("https://nova.example", async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return Response.json({ status: "ready" });
    });
    expect(results.every(({ status }) => status === "pass")).toBe(true);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(["/api/health", "/api/ready"]);
    for (const request of requests) {
      expect(request.init.credentials).toBe("omit");
      expect(request.init.cache).toBe("no-store");
      expect(request.init.headers).toEqual({ accept: "application/json" });
    }
  });

  test("read-only command reports the exact failed check and exits nonzero", async () => {
    const output: string[] = [];
    const result = await runDeploymentDoctor(["--api-origin", "https://nova.example"], {
      runPreflight: async () => ({ code: 1, stdout: "", stderr: "28P01" }),
      readUpdateAttempt: async () => undefined,
      fetch: async () => new Response(null, { status: 503 }),
      write: (line) => output.push(line),
    });
    expect(result).toBe(1);
    expect(output.join("\n")).toContain("rotate-app-role-password");
    expect(output.join("\n")).toContain("/api/ready returned HTTP 503");
    expect(output.join("\n")).toContain("no database, host, or scheduler changes");
  });

  test("arguments are explicit and reject an untrusted api origin", () => {
    expect(parseDoctorArguments(["--api-origin", "https://nova.example"])).toEqual({
      apiOrigin: "https://nova.example",
      help: false,
    });
    expect(() => parseDoctorArguments(["--api-origin", "https://nova.example/path"]))
      .toThrow("DOCTOR_API_ORIGIN_INVALID");
    expect(() => parseDoctorArguments(["--unknown"]))
      .toThrow("DOCTOR_OPTION_UNSUPPORTED:--unknown");
  });
});
