import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { configuredSupabasePoolerHost, resolveSupabasePoolerHost } from "../server/src/supabase-pooler.ts";
import { isSecretsEncryptionKeyValid } from "../server/src/secrets.ts";
import { confirmSupabaseProject } from "../server/src/supabase-project-confirmation.ts";

type SetupMode = "docker" | "external" | "supabase";

const root = resolve(import.meta.dir, "..");
const envPath = resolve(root, ".env");
const composePath = resolve(root, "docker", "compose.yaml");

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

function updateEnvFile(values: Record<string, string>, removeKeys: readonly string[] = []): void {
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
  writeFileSync(envPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

async function configureSupabaseEnvironment(): Promise<Record<string, string>> {
  const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  // Explicit CLI/process configuration must beat the persisted default. This
  // lets an operator safely select a different project without `.env` silently
  // sending setup back to the old one.
  const requestedProjectRef = optionalArgument("--project-ref") ?? process.env.NOVA_SUPABASE_PROJECT_REF;
  const projectRef = requestedProjectRef ?? existing.NOVA_SUPABASE_PROJECT_REF ?? await promptValue("Supabase project ref");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  await confirmSupabaseProject(projectRef, "apply NOVA migrations and configure the restricted application role");
  const accessToken = optionalArgument("--access-token") ?? process.env.SUPABASE_ACCESS_TOKEN ??
    existing.SUPABASE_ACCESS_TOKEN ?? await promptValue("Supabase project-scoped access token");
  const appPassword = existing.NOVA_APP_PASSWORD ?? optionalArgument("--app-password") ??
    process.env.NOVA_APP_PASSWORD ?? secret(24);
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED");
  if (appPassword.length < 24) throw new Error("NOVA_APP_PASSWORD_TOO_SHORT");

  const configuredHost = configuredSupabasePoolerHost({
    projectRef,
    explicitHost: optionalArgument("--pooler-host"),
    environmentProjectRef: process.env.NOVA_SUPABASE_PROJECT_REF,
    environmentHost: process.env.NOVA_SUPABASE_POOLER_HOST,
    savedProjectRef: existing.NOVA_SUPABASE_PROJECT_REF,
    savedHost: existing.NOVA_SUPABASE_POOLER_HOST,
  });
  const poolerHost = configuredHost ?? await resolveSupabasePoolerHost(projectRef, accessToken);
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
  const persisted = { ...values };
  delete persisted.SUPABASE_ACCESS_TOKEN;
  delete persisted.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
  updateEnvFile(persisted, ["SUPABASE_ACCESS_TOKEN", "Supabaseaccesstoken", "NOVA_SUPABASE_PROJECT_REF_CONFIRM"]);
  console.info(`Configured ${envPath} for Supabase project ${projectRef}.`);
  console.info("The management token is for this bootstrap command only; never upload it to Netlify, Vercel, or a public repository.");
  return values;
}

function createLocalEnv(): Record<string, string> {
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

function loadEnvironment(mode: SetupMode): Record<string, string> {
  if (!existsSync(envPath)) {
    if (mode === "external") throw new Error("EXTERNAL_ENV_FILE_REQUIRED");
    return createLocalEnv();
  }
  const values = parseEnv(readFileSync(envPath, "utf8"));
  if (!values.NOVA_BACKGROUND_JOB_SECRET) {
    values.NOVA_BACKGROUND_JOB_SECRET = secret(32);
    updateEnvFile({ NOVA_BACKGROUND_JOB_SECRET: values.NOVA_BACKGROUND_JOB_SECRET });
    console.info("Generated NOVA_BACKGROUND_JOB_SECRET for the deployment scheduler.");
  }
  if (!values.NOVA_BACKGROUND_SCHEDULER) {
    values.NOVA_BACKGROUND_SCHEDULER = "vps";
    updateEnvFile({ NOVA_BACKGROUND_SCHEDULER: values.NOVA_BACKGROUND_SCHEDULER });
  }
  updateEnvFile({}, ["SUPABASE_ACCESS_TOKEN", "Supabaseaccesstoken"]);
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

const mode = (argument("--mode") ?? "docker") as SetupMode;
if (mode !== "docker" && mode !== "external" && mode !== "supabase") throw new Error("SETUP_MODE_INVALID");
if (mode === "docker") verifyDockerEngine();

const environment = mode === "supabase"
  ? await configureSupabaseEnvironment()
  : loadEnvironment(mode);
if (!isSecretsEncryptionKeyValid(environment)) {
  throw new Error("NOVA_SECRETS_ENCRYPTION_KEY_INVALID");
}
if (mode === "docker") {
  run("docker", ["compose", "--env-file", envPath, "-f", composePath, "up", "--build", "-d"], environment, "DOCKER_COMPOSE_FAILED");
  waitForHealth(environment.BETTER_AUTH_URL ?? "http://localhost:3001", environment);
} else if (mode === "external") {
  required(environment, "MIGRATOR_DATABASE_URL");
  run(process.execPath, ["run", "migrate"], environment, "MIGRATION_FAILED");
} else {
  run(process.execPath, ["run", "supabase:bootstrap"], environment, "SUPABASE_BOOTSTRAP_FAILED");
}

run(process.execPath, ["run", "deployment:preflight"], environment, "PREFLIGHT_FAILED");
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
