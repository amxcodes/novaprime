import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const composeFile = resolve(repositoryRoot, "docker", "compose.yaml");
const projectName = `nova-qa-${randomUUID()}`;
const loadEmployeeCount = process.env.NOVA_QA_LOAD_EMPLOYEES;
if (loadEmployeeCount !== undefined && !/^(?:0|[1-9]\d?|100)$/.test(loadEmployeeCount)) {
  throw new Error("NOVA_QA_LOAD_EMPLOYEES_MUST_BE_BETWEEN_0_AND_100");
}
function optionalPoolOverride(name: string, maximum: number): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name}_MUST_BE_BETWEEN_1_AND_${maximum}`);
  }
  return value;
}
const qaDbPoolMax = optionalPoolOverride("NOVA_QA_DB_POOL_MAX", 50);
const qaAuthPoolMax = optionalPoolOverride("NOVA_QA_AUTH_POOL_MAX", 25);
const qaRequestScoped = process.env.NOVA_QA_REQUEST_SCOPED === "true";
if (loadEmployeeCount && loadEmployeeCount !== "0") {
  console.info(`Optional synthetic employee load profile: ${loadEmployeeCount} employees`);
}
if (qaDbPoolMax || qaAuthPoolMax) {
  console.info(`QA pool profile: database=${qaDbPoolMax ?? "configured default"}, auth=${qaAuthPoolMax ?? "configured default"}`);
}
if (qaRequestScoped) {
  console.info("QA profile: request-scoped direct PostgreSQL clients; this local test does not include Hyperdrive pooling");
}

const privateQaDirectory = await mkdtemp(join(tmpdir(), "nova-qa-config-"));
const envFile = join(privateQaDirectory, ".env");
const qaSecrets = {
  NOVA_MIGRATOR_PASSWORD: randomBytes(32).toString("base64url"),
  NOVA_APP_PASSWORD: randomBytes(32).toString("base64url"),
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
  NOVA_BOOTSTRAP_TOKEN: randomBytes(32).toString("base64url"),
  NOVA_SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  NOVA_BACKGROUND_JOB_SECRET: randomBytes(32).toString("base64url"),
};
const qaEnvironment = {
  ...qaSecrets,
  BETTER_AUTH_URL: "http://localhost:3001",
  NOVA_BACKGROUND_SCHEDULER: "vps",
  NOVA_MAINTENANCE_INTERVAL_SECONDS: "10",
  NOVA_DB_POOL_MAX: "10",
  NOVA_AUTH_POOL_MAX: "5",
  NOVA_QA_DB_POOL_MAX: qaDbPoolMax ?? "",
  NOVA_QA_AUTH_POOL_MAX: qaAuthPoolMax ?? "",
  NOVA_QA_LOAD_EMPLOYEES: loadEmployeeCount ?? "0",
  NOVA_QA_REQUEST_SCOPED: qaRequestScoped ? "true" : "false",
};
try {
  await writeFile(envFile, Object.entries(qaEnvironment).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(privateQaDirectory, 0o700);
} catch {
  await rm(privateQaDirectory, { recursive: true, force: true });
  throw new Error("LOCAL_POSTGRES_QA_PRIVATE_CONFIG_FAILED");
}

// Do not let a caller's ordinary NOVA/.env settings override the disposable
// credentials in the explicit Compose env file.
const composeEnvironment: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(composeEnvironment)) {
  if (key.startsWith("NOVA_") || key.startsWith("BETTER_AUTH_") ||
      key === "DATABASE_URL" || key === "MIGRATOR_DATABASE_URL" || key === "SUPABASE_ACCESS_TOKEN") {
    delete composeEnvironment[key];
  }
}
const composePrefix = (forWsl = false) => [
  "compose",
  "--project-name",
  projectName,
  "-f",
  forWsl ? wslPath(composeFile) : composeFile,
  "--env-file",
  forWsl ? wslPath(envFile) : envFile,
];

function reportResult(result: ReturnType<typeof spawnSync>): void {
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function wslPath(windowsPath: string): string {
  const result = spawnSync("wsl.exe", ["-e", "wslpath", "-a", windowsPath], {
    encoding: "utf8",
    cwd: repositoryRoot,
    env: composeEnvironment,
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error("LOCAL_POSTGRES_QA_WSL_PATH_UNAVAILABLE");
  }
  return result.stdout.trim();
}

console.info(`Isolated QA Compose project: ${projectName}`);
try {
  console.info("Using random, run-scoped credentials from a private temporary env file; repository .env values are excluded.");
  const native = spawnSync("docker", [...composePrefix(), "--profile", "qa", "run", "--build", "--rm", "qa"], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: composeEnvironment,
  });
  const dockerCliMissing = native.error !== undefined && (native.error as NodeJS.ErrnoException).code === "ENOENT";

  if (process.platform === "win32" && dockerCliMissing) {
    console.info("Docker CLI not found on Windows; using the configured WSL Docker engine.");
    const result = spawnSync("wsl.exe", ["-e", "docker", ...composePrefix(true),
      "--profile", "qa", "run", "--build", "--rm", "qa"], {
      cwd: repositoryRoot,
      stdio: "inherit",
      env: composeEnvironment,
    });
    reportResult(result);
    if (result.status === 0) cleanIsolatedProject(true);
    else stopFailedProject(true);
  } else {
    reportResult(native);
    if (native.status === 0) cleanIsolatedProject(false);
    else stopFailedProject(false);
  }
} finally {
  if (process.exitCode === 0) {
    await rm(privateQaDirectory, { recursive: true, force: true });
    console.info("Private run-scoped QA credentials removed.");
  } else {
    console.error(`QA_PRIVATE_CONFIG_PRESERVED_FOR_DIAGNOSIS ${envFile}; it contains random test credentials, not repository secrets.`);
  }
}

function docker(args: string[], useWsl: boolean) {
  return useWsl
    ? spawnSync("wsl.exe", ["-e", "docker", ...args], { cwd: repositoryRoot, encoding: "utf8", env: composeEnvironment })
    : spawnSync("docker", args, { cwd: repositoryRoot, encoding: "utf8", env: composeEnvironment });
}

function stopFailedProject(useWsl: boolean): void {
  const stopped = docker(
    [...composePrefix(useWsl), "--profile", "qa", "stop", "postgres-qa"],
    useWsl,
  );
  if (stopped.error || stopped.status !== 0) {
    console.error(`QA_FAILURE_CLEANUP_FAILED_${projectName}; project and database were preserved.`);
    return;
  }
  console.error(`QA_FAILED_PROJECT_PRESERVED_${projectName}; postgres-qa stopped and its volume retained for diagnosis.`);
}

function cleanIsolatedProject(useWsl: boolean): void {
  const down = docker(
    [...composePrefix(useWsl), "--profile", "qa", "down", "--remove-orphans"],
    useWsl,
  );
  if (down.error || down.status !== 0) {
    console.error(`QA_PROJECT_CLEANUP_FAILED_${projectName}; isolated resources were retained.`);
    process.exitCode = 1;
    return;
  }

  for (const volumeLabel of ["nova_qa_postgres_data", "nova_qa_postgres_tls"]) {
    const listed = docker([
      "volume", "ls", "--quiet",
      "--filter", `label=com.docker.compose.project=${projectName}`,
      "--filter", `label=com.docker.compose.volume=${volumeLabel}`,
    ], useWsl);
    if (listed.error || listed.status !== 0) {
      console.error(`QA_VOLUME_AUDIT_FAILED_${projectName}; isolated volume ${volumeLabel} was retained.`);
      process.exitCode = 1;
      return;
    }

    const volumeNames = listed.stdout.trim().split(/\s+/).filter(Boolean);
    if (volumeNames.length === 0) continue;
    if (volumeNames.length !== 1) {
      console.error(`QA_VOLUME_COUNT_UNEXPECTED_${projectName}; isolated volumes were retained.`);
      process.exitCode = 1;
      return;
    }

    const inspected = docker(["volume", "inspect", volumeNames[0]!], useWsl);
    if (inspected.error || inspected.status !== 0) {
      console.error(`QA_VOLUME_INSPECT_FAILED_${projectName}; isolated volume ${volumeLabel} was retained.`);
      process.exitCode = 1;
      return;
    }

    const metadata = JSON.parse(inspected.stdout)[0] as { Labels?: Record<string, string> } | undefined;
    if (metadata?.Labels?.["com.docker.compose.project"] !== projectName
      || metadata.Labels["com.docker.compose.volume"] !== volumeLabel) {
      console.error(`QA_VOLUME_IDENTITY_MISMATCH_${projectName}; isolated volume ${volumeLabel} was retained.`);
      process.exitCode = 1;
      return;
    }

    const removed = docker(["volume", "rm", volumeNames[0]!], useWsl);
    if (removed.error || removed.status !== 0) {
      console.error(`QA_VOLUME_REMOVAL_FAILED_${projectName}; isolated volume ${volumeLabel} was retained.`);
      process.exitCode = 1;
      return;
    }
  }
  console.info("Isolated QA containers and verified run-scoped PostgreSQL data and TLS volumes removed.");
}
