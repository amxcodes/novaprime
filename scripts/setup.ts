import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertSupabaseAppPasswordProjectBinding,
  resolveSupabasePoolerHost,
  selectSupabasePoolerHost,
  supabaseManagementFailureCode,
} from "../server/src/supabase-pooler.ts";
import { applicationRoleProvisioningSql } from "../server/src/application-role-provisioning.ts";
import { isSecretsEncryptionKeyValid } from "../server/src/secrets.ts";
import { confirmSupabaseProject } from "../server/src/supabase-project-confirmation.ts";
import { promptSecret } from "./update/terminal.ts";
import { resolveSetupEnvironmentPath } from "./setup-env-path.ts";

type SetupMode = "docker" | "external" | "supabase";
const root = resolve(import.meta.dir, "..");
const composePath = resolve(root, "docker", "compose.yaml");

const rotationPhaseKey = "NOVA_APP_PASSWORD_ROTATION_PHASE";
const rotationProjectKey = "NOVA_APP_PASSWORD_ROTATION_PROJECT_REF";
const rotationFingerprintKey = "NOVA_APP_PASSWORD_ROTATION_PASSWORD_SHA256";
const rotationRetryAfterKey = "NOVA_APP_PASSWORD_ROTATION_RETRY_AFTER";
const rotationStateKeys = [rotationPhaseKey, rotationProjectKey, rotationFingerprintKey, rotationRetryAfterKey] as const;
const poolerRetryDelaysMs = [15_000, 30_000] as const;
const poolerRetryCooldownMs = 120_000;

export type SupabaseRotationPhase = "pending" | "applying" | "applied";
export interface SupabaseRotationCheckpoint {
  phase: SupabaseRotationPhase;
  projectRef: string;
  passwordFingerprint: string;
  retryAfter?: number;
}

export interface SupabaseReadinessResult {
  ok: boolean;
  code?: string;
}

function passwordFingerprint(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex");
}

export function readSupabaseRotationCheckpoint(
  values: Readonly<Record<string, string | undefined>>,
): SupabaseRotationCheckpoint | undefined {
  const [phase, projectRef, fingerprint, retryAfterText] = rotationStateKeys.map((key) => values[key]);
  if (phase === undefined && projectRef === undefined && fingerprint === undefined && retryAfterText === undefined) return undefined;
  const retryAfter = retryAfterText === undefined ? undefined : Number(retryAfterText);
  if (
    (phase !== "pending" && phase !== "applying" && phase !== "applied") ||
    !projectRef || !/^[a-z0-9]{20}$/.test(projectRef) ||
    !fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint) ||
    (retryAfterText !== undefined && (!/^\d+$/.test(retryAfterText) || !Number.isSafeInteger(retryAfter) || retryAfter! <= 0)) ||
    (retryAfter !== undefined && phase === "pending")
  ) {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_STATE_INVALID");
  }
  return { phase, projectRef, passwordFingerprint: fingerprint, ...(retryAfter === undefined ? {} : { retryAfter }) };
}

/** Serialize setup for one environment file; existing locks are never auto-removed. */
export async function withSetupLock<T>(envPath: string, operation: () => T | Promise<T>): Promise<T> {
  const lockPath = join(realpathSync(dirname(envPath)), `${basename(envPath)}.setup.lock`);
  const owner = randomBytes(16).toString("hex");
  const metadata = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "unknown",
    owner,
  }) + "\n";
  let descriptor: number;
  try {
    // Windows ignores POSIX mode bits and uses the parent directory ACL.
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    if (code === "EEXIST") {
      throw new Error(
        `NOVA_SETUP_LOCK_BUSY: another setup may be using ${lockPath}. Inspect any recorded PID, host, and start time; if metadata is missing, check for a setup process directly. Confirm the owner has stopped before manually removing only this lock file and retrying. NOVA never removes an existing lock automatically.`,
      );
    }
    throw new Error(`NOVA_SETUP_LOCK_CREATE_FAILED:${code}`);
  }

  let descriptorOpen = true;
  try {
    writeFileSync(descriptor, metadata, { encoding: "utf8" });
    fsyncSync(descriptor);
  } catch (error) {
    try { closeSync(descriptor); } catch { /* Keep the initialization error. */ }
    descriptorOpen = false;
    if (setupLockHasOwner(lockPath, owner)) {
      try { unlinkSync(lockPath); } catch { /* Preserve the original failure. */ }
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    throw new Error(`NOVA_SETUP_LOCK_INITIALIZATION_FAILED:${code}`);
  }

  try {
    return await operation();
  } finally {
    if (descriptorOpen) {
      try { closeSync(descriptor); } catch { /* Cleanup below remains best-effort. */ }
    }
    // A human may have replaced a stale lock while setup was running. Never
    // delete a lock whose random owner marker no longer matches this process.
    if (setupLockHasOwner(lockPath, owner)) {
      try { unlinkSync(lockPath); } catch { /* Leave a recoverable lock for manual inspection. */ }
    }
  }
}

function setupLockHasOwner(lockPath: string, owner: string): boolean {
  try {
    const metadata = JSON.parse(readFileSync(lockPath, "utf8")) as { owner?: unknown };
    return metadata.owner === owner;
  } catch {
    return false;
  }
}

function setRotationCheckpoint(
  values: Record<string, string>,
  phase: SupabaseRotationPhase,
  projectRef: string,
): void {
  values[rotationPhaseKey] = phase;
  values[rotationProjectKey] = projectRef;
  values[rotationFingerprintKey] = passwordFingerprint(values.NOVA_APP_PASSWORD ?? "");
}

function validateRotationCandidate(
  values: Readonly<Record<string, string | undefined>>,
  checkpoint: SupabaseRotationCheckpoint,
): void {
  if (values.NOVA_SUPABASE_PROJECT_REF !== checkpoint.projectRef) {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_PROJECT_MISMATCH");
  }
  if (!values.NOVA_APP_PASSWORD || passwordFingerprint(values.NOVA_APP_PASSWORD) !== checkpoint.passwordFingerprint) {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_CANDIDATE_CHANGED");
  }
}

/** Keep one project-bound candidate through bootstrap, an ambiguous ALTER, and pooler readiness recovery. */
export async function runSupabaseSetupFlow(input: {
  environment: Record<string, string>;
  bootstrap: () => void | Promise<void>;
  applyPassword: () => void | Promise<void>;
  preflight: () => SupabaseReadinessResult | Promise<SupabaseReadinessResult>;
  persist: (values: Readonly<Record<string, string>>, removeKeys?: readonly string[]) => void | Promise<void>;
  recoverUnknownRotation?: boolean;
  sleep?: (milliseconds: number) => void | Promise<void>;
  log?: (message: string) => void;
  now?: () => number;
}): Promise<void> {
  const checkpoint = readSupabaseRotationCheckpoint(input.environment);
  if (!checkpoint) {
    if (input.recoverUnknownRotation) {
      throw new Error("SUPABASE_APP_PASSWORD_ROTATION_RECOVERY_NOT_APPLICABLE: no applying checkpoint exists");
    }
    await input.bootstrap();
    const ready = await input.preflight();
    if (!ready.ok) throw new Error(`PREFLIGHT_FAILED:${ready.code ?? "DATABASE_NOT_READY"}`);
    return;
  }

  validateRotationCandidate(input.environment, checkpoint);
  if (input.recoverUnknownRotation && checkpoint.phase !== "applying") {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_RECOVERY_NOT_APPLICABLE: recovery is only valid for an applying checkpoint");
  }

  let phase = checkpoint.phase;
  if (checkpoint.phase === "pending") {
    // Persist that the remote outcome may become ambiguous before making the
    // request. A crash after ALTER therefore resumes with candidate probes.
    await input.bootstrap();
    setRotationCheckpoint(input.environment, "applying", checkpoint.projectRef);
    await input.persist(input.environment);
    await input.applyPassword();
    setRotationCheckpoint(input.environment, "applied", checkpoint.projectRef);
    delete input.environment[rotationRetryAfterKey];
    await input.persist(input.environment);
    phase = "applied";
  }

  const now = input.now ?? Date.now;
  const currentCheckpoint = readSupabaseRotationCheckpoint(input.environment)!;
  const recoveryCooldownExpired = phase === "applying" &&
    currentCheckpoint.retryAfter !== undefined && currentCheckpoint.retryAfter <= now();
  if (currentCheckpoint.retryAfter !== undefined && currentCheckpoint.retryAfter > now()) {
    const seconds = Math.ceil((currentCheckpoint.retryAfter - now()) / 1000);
    const recoveryHint = phase === "applying"
      ? " If exact-candidate probes still fail after the cooldown, rerun with --recover-app-role-password-rotation to reapply the same candidate."
      : " The confirmed role password will not be rotated again.";
    throw new Error(`SUPABASE_POOLER_ROTATION_RETRY_LATER: wait ${seconds} seconds, then retry without --rotate-app-role-password.${recoveryHint}`);
  }
  if (currentCheckpoint.retryAfter !== undefined) {
    delete input.environment[rotationRetryAfterKey];
    await input.persist(input.environment, [rotationRetryAfterKey]);
  }

  const probeCandidate = async (allowRecoveryAfterFailures: boolean): Promise<boolean> => {
    for (let attempt = 0; attempt <= poolerRetryDelaysMs.length; attempt += 1) {
      const ready = await input.preflight();
      if (ready.ok) {
        for (const key of rotationStateKeys) delete input.environment[key];
        await input.persist(input.environment, rotationStateKeys);
        return true;
      }
      if (ready.code !== "28P01") {
        throw new Error(`PREFLIGHT_FAILED:${ready.code ?? "DATABASE_NOT_READY"}`);
      }
      const delay = poolerRetryDelaysMs[attempt];
      if (delay === undefined) {
        if (!allowRecoveryAfterFailures) {
          input.environment[rotationRetryAfterKey] = String(now() + poolerRetryCooldownMs);
          await input.persist(input.environment);
        }
        return false;
      }
      input.environment[rotationRetryAfterKey] = String(now() + delay);
      await input.persist(input.environment);
      input.log?.(`Supabase shared-pooler credentials may still be refreshing; retrying readiness in ${delay / 1000} seconds. NOVA will not change the candidate password.`);
      if (input.sleep) await input.sleep(delay);
      else await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
  };

  if (await probeCandidate(
    phase === "applying" && input.recoverUnknownRotation === true && recoveryCooldownExpired,
  )) return;

  if (phase === "applying" && input.recoverUnknownRotation) {
    if (!recoveryCooldownExpired) {
      const cooldown = readSupabaseRotationCheckpoint(input.environment)?.retryAfter ?? now() + poolerRetryCooldownMs;
      const seconds = Math.max(1, Math.ceil((cooldown - now()) / 1000));
      throw new Error(
        `SUPABASE_APP_PASSWORD_ROTATION_RECOVERY_COOLDOWN_REQUIRED: candidate probes failed and NOVA saved a cooldown. Wait ${seconds} seconds, then rerun with --recover-app-role-password-rotation to reapply the same project-bound candidate.`,
      );
    }
    // The exact persisted candidate failed all readiness probes. The explicit
    // operator flag authorizes only reapplying this candidate to this project.
    delete input.environment[rotationRetryAfterKey];
    await input.persist(input.environment, [rotationRetryAfterKey]);
    await input.applyPassword();
    setRotationCheckpoint(input.environment, "applied", checkpoint.projectRef);
    await input.persist(input.environment);
    phase = "applied";
    if (await probeCandidate(false)) return;
    throw new Error("SUPABASE_POOLER_ROTATION_PROPAGATION_PENDING: the same candidate was explicitly reapplied and confirmed by Supabase, but the pooler is not ready. Wait for the saved cooldown and retry without either rotation flag.");
  }

  if (phase === "applying") {
    throw new Error(
      "SUPABASE_APP_PASSWORD_ROTATION_OUTCOME_UNKNOWN: the project-bound candidate was retained and probed, but NOVA will not ALTER it again automatically. Wait for the saved cooldown, retry setup without rotation flags, and only if exact-candidate probes still fail rerun `bun run setup:supabase -- --recover-app-role-password-rotation` to reapply this same candidate.",
    );
  }
  throw new Error("SUPABASE_POOLER_ROTATION_PROPAGATION_PENDING: the role password is confirmed; wait for the saved cooldown and retry without either rotation flag.");
}

function secret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function parseEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (match && !match[2].startsWith("#")) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function run(command: string, args: string[], environment: Record<string, string>, label: string): void {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: exited with ${result.status ?? "signal"}`);
}

function verifyDockerEngine(): void {
  const compose = spawnSync("docker", ["compose", "version"], {
    cwd: root,
    stdio: "ignore",
    shell: false,
  });
  const engine = compose.status === 0
    ? spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      cwd: root,
      stdio: "ignore",
      shell: false,
    })
    : undefined;
  if (!compose.error && compose.status === 0 && engine && !engine.error && engine.status === 0) return;

  if (process.platform === "win32") {
    throw new Error(
      "WINDOWS_DOCKER_UNAVAILABLE: Install and start Docker Desktop before local setup. If Docker Engine exists only inside WSL, run `bash docker/bootstrap.sh` from an interactive WSL shell and keep that shell open while using NOVA; Windows `bun run setup` cannot use a WSL-only Docker CLI.",
    );
  }
  throw new Error("DOCKER_ENGINE_UNAVAILABLE: Install/start Docker Engine with the Compose v2 plugin, then retry local setup.");
}

function waitForHealth(baseUrl: string, environment: Record<string, string>): void {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = spawnSync(process.execPath, ["-e", `fetch(${JSON.stringify(`${baseUrl}/api/health`)}).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: "ignore",
      shell: false,
    });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  throw new Error("NOVA_API_HEALTH_TIMEOUT");
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value || value.startsWith("replace-with-") || value.startsWith("your-")) {
    throw new Error(`${key}_REQUIRED`);
  }
  return value;
}

function optionalArgument(name: string): string | undefined {
  const value = argument(name);
  return value?.trim() || undefined;
}

async function promptValue(label: string): Promise<string> {
  const readline = await import("node:readline/promises");
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await input.question(`${label}: `)).trim();
  } finally {
    input.close();
  }
}

function updateEnvFile(envPath: string, values: Record<string, string>, removeKeys: readonly string[] = []): void {
  const source = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const pending = new Map(Object.entries(values));
  const removals = new Set(removeKeys);
  const lines = source.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=/);
    return !match || !removals.has(match[1]);
  }).map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=/);
    if (!match || !pending.has(match[1])) return line;
    const key = match[1];
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  const temporaryPath = `${envPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const content = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    // POSIX files are restricted to 0600. Windows ignores mode bits: the
    // replacement inherits its parent directory ACL, not a custom ACL on the
    // previous .env file. Operators who set per-file ACLs must also secure the
    // containing directory before using atomic updates.
    if (process.platform !== "win32") chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, envPath);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* No temporary file to clean up. */ }
    throw error;
  }
}

async function configureSupabaseEnvironment(envPath: string): Promise<Record<string, string>> {
  const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  const savedRotation = readSupabaseRotationCheckpoint(existing);
  const recoverUnknownRotation = process.argv.includes("--recover-app-role-password-rotation");
  // Explicit CLI/process configuration must beat the persisted default. This
  // lets an operator safely select a different project without `.env` silently
  // sending setup back to the old one.
  const requestedProjectRef = optionalArgument("--project-ref") ?? process.env.NOVA_SUPABASE_PROJECT_REF;
  const projectRef = requestedProjectRef ?? existing.NOVA_SUPABASE_PROJECT_REF ?? await promptValue("Supabase project ref");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  if (savedRotation) {
    if (process.argv.includes("--rotate-app-role-password")) {
      throw new Error("SUPABASE_APP_PASSWORD_ROTATION_IN_PROGRESS: resume without --rotate-app-role-password");
    }
    if (recoverUnknownRotation && savedRotation.phase !== "applying") {
      throw new Error("SUPABASE_APP_PASSWORD_ROTATION_RECOVERY_NOT_APPLICABLE: only an applying checkpoint can be explicitly recovered");
    }
    validateRotationCandidate(existing, savedRotation);
  } else if (recoverUnknownRotation) {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_RECOVERY_NOT_APPLICABLE: no applying checkpoint exists");
  }
  await confirmSupabaseProject(projectRef, "apply NOVA migrations and configure the restricted application role");
  const accessToken = optionalArgument("--access-token") ?? process.env.SUPABASE_ACCESS_TOKEN ??
    existing.SUPABASE_ACCESS_TOKEN ?? await promptSecret("Supabase project-scoped access token");
  const rotateAppRolePassword = process.argv.includes("--rotate-app-role-password") && !savedRotation;
  assertSupabaseAppPasswordProjectBinding({
    projectRef,
    previousProjectRef: existing.NOVA_SUPABASE_PROJECT_REF,
    previousDatabaseUrl: existing.DATABASE_URL,
    rotateExistingPassword: rotateAppRolePassword,
  });
  const requestedAppPassword = optionalArgument("--app-password") ?? process.env.NOVA_APP_PASSWORD;
  const savedAppPassword = existing.NOVA_APP_PASSWORD;
  if (savedRotation && requestedAppPassword && requestedAppPassword !== savedAppPassword) {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_CANDIDATE_CHANGED");
  }
  if (
    !savedRotation && !rotateAppRolePassword && savedAppPassword && requestedAppPassword &&
    requestedAppPassword !== savedAppPassword
  ) {
    throw new Error("NOVA_APP_PASSWORD_CHANGE_REQUIRES_ROTATION_FLAG");
  }
  const appPassword = savedRotation
    ? required(existing, "NOVA_APP_PASSWORD")
    : rotateAppRolePassword
    ? requestedAppPassword && requestedAppPassword !== savedAppPassword
      ? requestedAppPassword
      : secret(24)
    : savedAppPassword ?? requestedAppPassword ?? secret(24);
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED");
  if (appPassword.length < 24) throw new Error("NOVA_APP_PASSWORD_TOO_SHORT");

  // A shared-pooler hostname contains a cluster index that cannot be inferred
  // from a region or project ref. Re-resolve it from this project's Supabase
  // configuration instead of trusting a saved host that may belong elsewhere.
  const poolerHost = selectSupabasePoolerHost({
    verifiedHost: await resolveSupabasePoolerHost(projectRef, accessToken),
    explicitHost: optionalArgument("--pooler-host"),
  });
  const values: Record<string, string> = {
    ...existing,
    NOVA_SUPABASE_PROJECT_REF: projectRef,
    NOVA_SUPABASE_PROJECT_REF_CONFIRM: projectRef,
    SUPABASE_ACCESS_TOKEN: accessToken,
    NOVA_APP_PASSWORD: appPassword,
    NOVA_SUPABASE_POOLER_HOST: poolerHost,
    NOVA_APPLICATION_DATABASE_ROLE: "nova_app",
    DATABASE_URL: `postgresql://nova_app.${projectRef}:${encodeURIComponent(appPassword)}@${poolerHost}:6543/postgres?sslmode=require&uselibpqcompat=true`,
    BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET ?? secret(32),
    BETTER_AUTH_URL: optionalArgument("--url") ?? existing.BETTER_AUTH_URL ?? "http://localhost:3001",
    NOVA_ALLOWED_ORIGINS: existing.NOVA_ALLOWED_ORIGINS ?? "http://localhost:3001",
    NOVA_BOOTSTRAP_TOKEN: existing.NOVA_BOOTSTRAP_TOKEN ?? secret(32),
    NOVA_SECRETS_ENCRYPTION_KEY: existing.NOVA_SECRETS_ENCRYPTION_KEY ?? secret(32),
    NOVA_BACKGROUND_JOB_SECRET: existing.NOVA_BACKGROUND_JOB_SECRET ?? secret(32),
    NOVA_BACKGROUND_SCHEDULER: existing.NOVA_BACKGROUND_SCHEDULER ?? "vps",
  };
  if (savedRotation) {
    values[rotationPhaseKey] = savedRotation.phase;
    values[rotationProjectKey] = savedRotation.projectRef;
    values[rotationFingerprintKey] = savedRotation.passwordFingerprint;
  } else if (rotateAppRolePassword) {
    setRotationCheckpoint(values, "pending", projectRef);
  }
  const persisted = { ...values };
  delete persisted.SUPABASE_ACCESS_TOKEN;
  delete persisted.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
  updateEnvFile(envPath, persisted, ["SUPABASE_ACCESS_TOKEN", "Supabaseaccesstoken", "NOVA_SUPABASE_PROJECT_REF_CONFIRM"]);
  console.info(`Configured ${envPath} for Supabase project ${projectRef}.`);
  console.info("The management token is for this bootstrap command only; never upload it to Netlify, Vercel, or a public repository.");
  if (rotateAppRolePassword) {
    console.warn("Explicit database password rotation selected. Update the API host's DATABASE_URL to this exact project and password before serving traffic.");
  } else {
    console.info("Existing nova_app password is preserved by default. Use --rotate-app-role-password only for a coordinated runtime secret rotation.");
  }
  return values;
}

function createLocalEnv(envPath: string): Record<string, string> {
  const migratorPassword = secret(24);
  const appPassword = secret(24);
  const values: Record<string, string> = {
    NOVA_MIGRATOR_PASSWORD: migratorPassword,
    NOVA_APP_PASSWORD: appPassword,
    NOVA_POSTGRES_PORT: "5432",
    NOVA_API_PORT: "3001",
    MIGRATOR_DATABASE_URL: `postgresql://nova_migrator:${migratorPassword}@localhost:5432/nova`,
    DATABASE_URL: `postgresql://nova_app:${appPassword}@localhost:5432/nova`,
    NOVA_APPLICATION_DATABASE_ROLE: "nova_app",
    BETTER_AUTH_SECRET: secret(32),
    BETTER_AUTH_URL: "http://localhost:3001",
    NOVA_ALLOWED_ORIGINS: "http://localhost:3001",
    NOVA_BOOTSTRAP_TOKEN: secret(32),
    NOVA_SECRETS_ENCRYPTION_KEY: secret(32),
    NOVA_BACKGROUND_JOB_SECRET: secret(32),
    NOVA_BACKGROUND_SCHEDULER: "vps",
  };
  const content = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  writeFileSync(envPath, content, { encoding: "utf8", flag: "wx" });
  console.info(`Created ${envPath} with fresh local secrets. Keep it private.`);
  return values;
}

function loadEnvironment(envPath: string, mode: SetupMode): Record<string, string> {
  if (!existsSync(envPath)) {
    if (mode === "external") throw new Error("EXTERNAL_ENV_FILE_REQUIRED");
    return createLocalEnv(envPath);
  }
  const values = parseEnv(readFileSync(envPath, "utf8"));
  if (!values.NOVA_BACKGROUND_JOB_SECRET) {
    values.NOVA_BACKGROUND_JOB_SECRET = secret(32);
    updateEnvFile(envPath, { NOVA_BACKGROUND_JOB_SECRET: values.NOVA_BACKGROUND_JOB_SECRET });
    console.info("Generated NOVA_BACKGROUND_JOB_SECRET for the deployment scheduler.");
  }
  if (!values.NOVA_BACKGROUND_SCHEDULER) {
    values.NOVA_BACKGROUND_SCHEDULER = "vps";
    updateEnvFile(envPath, { NOVA_BACKGROUND_SCHEDULER: values.NOVA_BACKGROUND_SCHEDULER });
  }
  updateEnvFile(envPath, {}, ["SUPABASE_ACCESS_TOKEN", "Supabaseaccesstoken"]);
  for (const key of [
    "DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "NOVA_BOOTSTRAP_TOKEN",
    "NOVA_SECRETS_ENCRYPTION_KEY", "NOVA_BACKGROUND_JOB_SECRET",
  ]) required(values, key);
  return values;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runSupabaseReadiness(environment: Record<string, string>): SupabaseReadinessResult {
  const result = spawnSync(process.execPath, ["run", "deployment:preflight"], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.status === 0 && !result.error) {
    if (result.stdout) process.stdout.write(result.stdout);
    return { ok: true };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/\b28P01\b|password authentication failed/i.test(output)) {
    return { ok: false, code: "28P01" };
  }
  return { ok: false, code: "PREFLIGHT_FAILED" };
}

async function applySupabaseApplicationPassword(environment: Record<string, string>): Promise<void> {
  const projectRef = required(environment, "NOVA_SUPABASE_PROJECT_REF");
  const accessToken = required(environment, "SUPABASE_ACCESS_TOKEN");
  const password = required(environment, "NOVA_APP_PASSWORD");
  let response: Response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: applicationRoleProvisioningSql(password, { rotateExistingPassword: true }),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("SUPABASE_APP_PASSWORD_ROTATION_OUTCOME_UNKNOWN: candidate retained; retry without rotation flags. If exact-candidate probes still fail after the saved cooldown, use --recover-app-role-password-rotation to reapply this same project-bound candidate.");
  }
  if (!response.ok) {
    throw new Error(`SUPABASE_APP_PASSWORD_ROTATION_FAILED:${supabaseManagementFailureCode("/database/query", response.status)}; candidate retained. Retry without rotation flags; use --recover-app-role-password-rotation only if later exact-candidate probes fail and the request can be retried.`);
  }
  if (response.status !== 204) {
    try { await response.body?.cancel(); } catch { /* Ignore a response-body cleanup error. */ }
  }
}

async function runSetup(envPath: string, mode: SetupMode): Promise<void> {
  if (mode !== "docker" && mode !== "external" && mode !== "supabase") throw new Error("SETUP_MODE_INVALID");
  if (process.platform === "win32") {
    console.warn("Windows .env writes inherit the containing directory ACL; atomic replacement cannot preserve a stricter file-only ACL, and NOVA does not set POSIX 0600 permissions on Windows. Restrict the directory ACL if these secrets require tighter access.");
  }
  if (mode === "docker") verifyDockerEngine();

  const environment = mode === "supabase"
    ? await configureSupabaseEnvironment(envPath)
    : loadEnvironment(envPath, mode);
  if (!isSecretsEncryptionKeyValid(environment)) {
    throw new Error("NOVA_SECRETS_ENCRYPTION_KEY_INVALID");
  }
  if (mode === "docker") {
    run("docker", ["compose", "--env-file", envPath, "-f", composePath, "up", "--build", "-d"], environment, "DOCKER_COMPOSE_FAILED");
    waitForHealth(environment.BETTER_AUTH_URL ?? "http://localhost:3001", environment);
    run(process.execPath, ["run", "deployment:preflight"], environment, "PREFLIGHT_FAILED");
  } else if (mode === "external") {
    required(environment, "MIGRATOR_DATABASE_URL");
    run(process.execPath, ["run", "migrate"], environment, "MIGRATION_FAILED");
    run(process.execPath, ["run", "deployment:preflight"], environment, "PREFLIGHT_FAILED");
  } else {
    await runSupabaseSetupFlow({
      environment,
      bootstrap: () => run(
        process.execPath,
        ["run", "supabase:bootstrap"],
        environment,
        "SUPABASE_BOOTSTRAP_FAILED",
      ),
      applyPassword: () => applySupabaseApplicationPassword(environment),
      preflight: () => runSupabaseReadiness(environment),
      recoverUnknownRotation: process.argv.includes("--recover-app-role-password-rotation"),
      persist: (values, removeKeys = []) => {
        const persisted = { ...values };
        delete persisted.SUPABASE_ACCESS_TOKEN;
        delete persisted.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
        updateEnvFile(envPath, persisted, [
          "SUPABASE_ACCESS_TOKEN", "Supabaseaccesstoken", "NOVA_SUPABASE_PROJECT_REF_CONFIRM", ...removeKeys,
        ]);
      },
      log: (message) => console.warn(message),
    });
  }

  const setupUrl = environment.BETTER_AUTH_URL ?? "http://localhost:3001";
  if (mode === "docker") {
    console.info(`NOVA API is running and passed health checks: ${setupUrl}`);
    console.info(`Open ${setupUrl} and use NOVA_BOOTSTRAP_TOKEN from ${envPath} for the one-time founder setup.`);
    console.info("After setup, rotate the bootstrap token and configure a customer-owned email adapter.");
  } else {
    console.info("Database migrations and restricted application-role preflight completed.");
    console.info("This command did not deploy or start NOVA's API.");
    if (mode === "supabase") {
      console.info("Next: copy only runtime values from the private local .env into the selected API host's server-side settings, deploy from the connected repository, then verify /api/health and /api/ready.");
    } else {
      console.info("Next: run `bun run dev` for a local API check, or deploy the API and configure its private runtime settings.");
    }
    if (mode === "supabase") {
      console.info(`Use NOVA_BOOTSTRAP_TOKEN from ${envPath} only after the hosted API passes /api/health and /api/ready at its configured public URL.`);
    } else {
      console.info(`Use NOVA_BOOTSTRAP_TOKEN from ${envPath} only after the API passes /api/health and /api/ready at ${setupUrl}.`);
    }
    console.info("After founder setup, rotate the bootstrap token and configure a customer-owned email adapter.");
  }
}

if (import.meta.main) {
  const envPath = resolveSetupEnvironmentPath(root, argument("--env-file"));
  const mode = (argument("--mode") ?? "docker") as SetupMode;
  await withSetupLock(envPath, () => runSetup(envPath, mode));
}
