import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSupabaseRotationCheckpoint, runSupabaseSetupFlow, withSetupLock } from "./setup.ts";

const candidatePassword = "candidate-secret-that-must-never-appear-in-output";
const accessToken = "supabase-token-that-must-never-appear-in-output";
const projectRef = "abcdefghijklmnopqrst";
const phaseKey = "NOVA_APP_PASSWORD_ROTATION_PHASE";
const projectKey = "NOVA_APP_PASSWORD_ROTATION_PROJECT_REF";
const fingerprintKey = "NOVA_APP_PASSWORD_ROTATION_PASSWORD_SHA256";
const retryAfterKey = "NOVA_APP_PASSWORD_ROTATION_RETRY_AFTER";
const rotationKeys = [phaseKey, projectKey, fingerprintKey, retryAfterKey];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "nova-setup-rotation-"));
  temporaryDirectories.push(directory);
  return directory;
}

function pendingEnvironment(): Record<string, string> {
  return {
    NOVA_SUPABASE_PROJECT_REF: projectRef,
    NOVA_APP_PASSWORD: candidatePassword,
    SUPABASE_ACCESS_TOKEN: accessToken,
    [phaseKey]: "pending",
    [projectKey]: projectRef,
    [fingerprintKey]: createHash("sha256").update(candidatePassword).digest("hex"),
  };
}

function persistIntoEnvironment(environment: Record<string, string>, events: string[] = []) {
  return (values: Readonly<Record<string, string>>, removeKeys: readonly string[] = []) => {
    events.push(`persist:${values[phaseKey] ?? "cleared"}`);
    for (const key of rotationKeys) {
      if (removeKeys.includes(key)) delete environment[key];
      else if (Object.hasOwn(values, key)) environment[key] = values[key]!;
    }
  };
}

describe("resumable Supabase app-role password rotation", () => {
  test("a failure before ALTER keeps the candidate pending and resumes after bootstrap", async () => {
    const environment = pendingEnvironment();
    const events: string[] = [];
    await expect(runSupabaseSetupFlow({
      environment,
      bootstrap: async () => {
        events.push("bootstrap-before-alter");
        throw new Error("INTERRUPTED_BEFORE_ROLE_ALTER");
      },
      applyPassword: () => { throw new Error("ALTER must not run before bootstrap succeeds"); },
      preflight: () => { throw new Error("preflight must not run before candidate confirmation"); },
      persist: persistIntoEnvironment(environment, events),
      sleep: () => { throw new Error("sleep must not run before ALTER completes"); },
    })).rejects.toThrow("INTERRUPTED_BEFORE_ROLE_ALTER");
    expect(readSupabaseRotationCheckpoint(environment)?.phase).toBe("pending");

    await runSupabaseSetupFlow({
      environment,
      bootstrap: async () => {
        expect(environment.NOVA_APP_PASSWORD).toBe(candidatePassword);
        events.push("bootstrap-retry");
      },
      applyPassword: async () => { events.push("alter-same-candidate"); },
      preflight: () => ({ ok: true }),
      persist: persistIntoEnvironment(environment, events),
      sleep: async () => undefined,
    });

    expect(events).toEqual([
      "bootstrap-before-alter",
      "bootstrap-retry",
      "persist:applying",
      "alter-same-candidate",
      "persist:applied",
      "persist:cleared",
    ]);
    expect(readSupabaseRotationCheckpoint(environment)).toBeUndefined();
  });

  test("an ambiguous ALTER outcome is checkpointed before the request and retries by probing only", async () => {
    const environment = pendingEnvironment();
    const events: string[] = [];
    await expect(runSupabaseSetupFlow({
      environment,
      bootstrap: () => { events.push("bootstrap-complete"); },
      applyPassword: async () => {
        expect(readSupabaseRotationCheckpoint(environment)?.phase).toBe("applying");
        events.push("alter-outcome-unknown");
        throw new Error("SUPABASE_APP_PASSWORD_ROTATION_OUTCOME_UNKNOWN");
      },
      preflight: () => { throw new Error("an unknown ALTER must not immediately probe in the same run"); },
      persist: persistIntoEnvironment(environment, events),
    })).rejects.toThrow("SUPABASE_APP_PASSWORD_ROTATION_OUTCOME_UNKNOWN");
    expect(readSupabaseRotationCheckpoint(environment)?.phase).toBe("applying");

    await runSupabaseSetupFlow({
      environment,
      bootstrap: () => { throw new Error("an applying checkpoint must not rerun bootstrap"); },
      applyPassword: () => { throw new Error("an applying checkpoint must not ALTER without explicit recovery"); },
      preflight: () => ({ ok: true }),
      persist: persistIntoEnvironment(environment, events),
    });
    expect(events).toEqual(["bootstrap-complete", "persist:applying", "alter-outcome-unknown", "persist:cleared"]);
    expect(readSupabaseRotationCheckpoint(environment)).toBeUndefined();
  });

  test("an applying checkpoint requires explicit recovery after bounded candidate probes fail", async () => {
    const environment = pendingEnvironment();
    environment[phaseKey] = "applying";
    const delays: number[] = [];
    const logs: string[] = [];
    let now = 1_000;
    let applyCalls = 0;
    const input = {
      environment,
      bootstrap: () => { throw new Error("applying must not bootstrap again"); },
      applyPassword: () => { applyCalls += 1; },
      preflight: () => ({ ok: false, code: "28P01" }),
      persist: persistIntoEnvironment(environment),
      sleep: (milliseconds: number) => { delays.push(milliseconds); now += milliseconds; },
      now: () => now,
      log: (message: string) => logs.push(message),
    };

    await expect(runSupabaseSetupFlow(input)).rejects.toThrow("SUPABASE_APP_PASSWORD_ROTATION_OUTCOME_UNKNOWN");
    expect(applyCalls).toBe(0);
    expect(delays).toEqual([15_000, 30_000]);
    expect(readSupabaseRotationCheckpoint(environment)?.phase).toBe("applying");
    const cooldown = readSupabaseRotationCheckpoint(environment)?.retryAfter;
    expect(cooldown).toBe(now + 120_000);
    expect(logs.join("\n")).not.toContain(candidatePassword);
    expect(logs.join("\n")).not.toContain(accessToken);

    now = cooldown!;
    let probes = 0;
    await runSupabaseSetupFlow({
      ...input,
      recoverUnknownRotation: true,
      preflight: () => ++probes <= 3 ? { ok: false, code: "28P01" } : { ok: true },
      applyPassword: () => {
        applyCalls += 1;
        expect(environment.NOVA_APP_PASSWORD).toBe(candidatePassword);
        expect(environment.NOVA_SUPABASE_PROJECT_REF).toBe(projectRef);
      },
    });
    expect(applyCalls).toBe(1);
    expect(probes).toBe(4);
    expect(readSupabaseRotationCheckpoint(environment)).toBeUndefined();
  });

  test("explicit recovery without an earlier cooldown first persists and waits for the cooldown", async () => {
    const environment = pendingEnvironment();
    environment[phaseKey] = "applying";
    const delays: number[] = [];
    let now = 5_000;
    let applyCalls = 0;

    await expect(runSupabaseSetupFlow({
      environment,
      bootstrap: () => { throw new Error("applying must not bootstrap again"); },
      applyPassword: () => { applyCalls += 1; },
      preflight: () => ({ ok: false, code: "28P01" }),
      persist: persistIntoEnvironment(environment),
      recoverUnknownRotation: true,
      sleep: (milliseconds) => { delays.push(milliseconds); now += milliseconds; },
      now: () => now,
    })).rejects.toThrow("SUPABASE_APP_PASSWORD_ROTATION_RECOVERY_COOLDOWN_REQUIRED");

    expect(applyCalls).toBe(0);
    expect(delays).toEqual([15_000, 30_000]);
    const cooldown = readSupabaseRotationCheckpoint(environment)?.retryAfter;
    expect(cooldown).toBe(now + 120_000);

    now = cooldown!;
    let probes = 0;
    await runSupabaseSetupFlow({
      environment,
      bootstrap: () => { throw new Error("applying must not bootstrap again"); },
      applyPassword: () => {
        applyCalls += 1;
        expect(environment.NOVA_APP_PASSWORD).toBe(candidatePassword);
        expect(environment.NOVA_SUPABASE_PROJECT_REF).toBe(projectRef);
      },
      preflight: () => ++probes <= 3 ? { ok: false, code: "28P01" } : { ok: true },
      persist: persistIntoEnvironment(environment),
      recoverUnknownRotation: true,
      sleep: (milliseconds) => { now += milliseconds; },
      now: () => now,
    });
    expect(applyCalls).toBe(1);
    expect(probes).toBe(4);
    expect(readSupabaseRotationCheckpoint(environment)).toBeUndefined();
  });

  test("applied rotations never ALTER again and preserve cooldown through restart", async () => {
    const environment = pendingEnvironment();
    environment[phaseKey] = "applied";
    const delays: number[] = [];
    let probes = 0;
    let now = 1_000;

    await expect(runSupabaseSetupFlow({
      environment,
      bootstrap: () => { throw new Error("an applied rotation must not bootstrap again"); },
      applyPassword: () => { throw new Error("an applied rotation must not be repeated"); },
      preflight: () => { probes += 1; return { ok: false, code: "28P01" }; },
      persist: persistIntoEnvironment(environment),
      sleep: (milliseconds) => { delays.push(milliseconds); now += milliseconds; },
      now: () => now,
    })).rejects.toThrow("SUPABASE_POOLER_ROTATION_PROPAGATION_PENDING");
    expect(probes).toBe(3);
    expect(delays).toEqual([15_000, 30_000]);
    const checkpoint = readSupabaseRotationCheckpoint(environment);
    expect(checkpoint?.phase).toBe("applied");
    expect(checkpoint?.retryAfter).toBe(now + 120_000);

    await expect(runSupabaseSetupFlow({
      environment,
      bootstrap: () => { throw new Error("an applied rotation must not bootstrap again"); },
      applyPassword: () => { throw new Error("an applied rotation must not be repeated"); },
      preflight: () => { probes += 1; return { ok: true }; },
      persist: persistIntoEnvironment(environment),
      now: () => now,
    })).rejects.toThrow("SUPABASE_POOLER_ROTATION_RETRY_LATER");
    expect(probes).toBe(3);

    now = checkpoint!.retryAfter!;
    await runSupabaseSetupFlow({
      environment,
      bootstrap: () => { throw new Error("an applied rotation must not bootstrap again"); },
      applyPassword: () => { throw new Error("an applied rotation must not be repeated"); },
      preflight: () => ({ ok: true }),
      persist: persistIntoEnvironment(environment),
      now: () => now,
    });
    expect(readSupabaseRotationCheckpoint(environment)).toBeUndefined();
  });

  test("candidate recovery rejects edited passwords and cross-project state without outputting secrets", async () => {
    const environment = pendingEnvironment();
    environment[phaseKey] = "applying";
    const input = {
      environment,
      bootstrap: () => { throw new Error("must not bootstrap"); },
      applyPassword: () => { throw new Error("must not ALTER before candidate validation"); },
      preflight: () => ({ ok: true }),
      persist: persistIntoEnvironment(environment),
      recoverUnknownRotation: true,
    };

    environment.NOVA_APP_PASSWORD = "a-different-candidate-secret";
    await expect(runSupabaseSetupFlow(input)).rejects.toThrow("SUPABASE_APP_PASSWORD_ROTATION_CANDIDATE_CHANGED");

    environment.NOVA_APP_PASSWORD = candidatePassword;
    environment.NOVA_SUPABASE_PROJECT_REF = "zyxwvutsrqponmlkjihg";
    await expect(runSupabaseSetupFlow(input)).rejects.toThrow("SUPABASE_APP_PASSWORD_ROTATION_PROJECT_MISMATCH");

    const message = "SUPABASE_APP_PASSWORD_ROTATION_OUTCOME_UNKNOWN: project-bound candidate retained";
    expect(message).not.toContain(candidatePassword);
    expect(message).not.toContain(accessToken);
  });
});

describe("per-environment setup lock", () => {
  test("never auto-removes an existing stale-looking lock", async () => {
    const directory = makeTemporaryDirectory();
    const envPath = join(directory, ".env");
    const lockPath = `${envPath}.setup.lock`;
    const existingLock = JSON.stringify({ pid: 4_294_000_000, startedAt: "2000-01-01T00:00:00.000Z", owner: "unknown-owner" });
    writeFileSync(lockPath, existingLock, "utf8");

    await expect(withSetupLock(envPath, () => { throw new Error("a busy lock must prevent setup"); }))
      .rejects.toThrow("NOVA_SETUP_LOCK_BUSY");
    expect(readFileSync(lockPath, "utf8")).toBe(existingLock);
  });

  test("rejects a concurrent setup and removes its own lock after success or failure", async () => {
    const directory = makeTemporaryDirectory();
    const envPath = join(directory, ".env");
    const lockPath = `${envPath}.setup.lock`;
    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondStarted = false;

    const first = withSetupLock(envPath, async () => {
      enterFirst();
      await firstGate;
    });
    await firstEntered;
    try {
      await expect(withSetupLock(envPath, () => { secondStarted = true; })).rejects.toThrow("NOVA_SETUP_LOCK_BUSY");
      expect(secondStarted).toBe(false);
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      releaseFirst();
    }
    await first;
    expect(existsSync(lockPath)).toBe(false);

    await expect(withSetupLock(envPath, () => { throw new Error("operation failed"); })).rejects.toThrow("operation failed");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("does not remove a lock that an operator replaced while setup was running", async () => {
    const directory = makeTemporaryDirectory();
    const envPath = join(directory, ".env");
    const lockPath = `${envPath}.setup.lock`;
    const replacement = JSON.stringify({ owner: "another-process" });

    await withSetupLock(envPath, () => {
      unlinkSync(lockPath);
      writeFileSync(lockPath, replacement, "utf8");
    });

    expect(readFileSync(lockPath, "utf8")).toBe(replacement);
  });
});
