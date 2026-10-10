import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const composeFile = resolve(repositoryRoot, "docker", "compose.yaml");
const projectName = `nova-qa-${randomUUID()}`;
const loadEmployeeCount = process.env.NOVA_QA_LOAD_EMPLOYEES;
if (loadEmployeeCount !== undefined && !/^(?:0|[1-9]\d?|1\d\d|200)$/.test(loadEmployeeCount)) {
  throw new Error("NOVA_QA_LOAD_EMPLOYEES_MUST_BE_BETWEEN_0_AND_200");
}
const restoreOnlyValue = process.env.NOVA_QA_RESTORE_ONLY;
if (restoreOnlyValue !== undefined && restoreOnlyValue !== "true" && restoreOnlyValue !== "false") {
  throw new Error("NOVA_QA_RESTORE_ONLY_MUST_BE_BOOLEAN");
}
const restoreOnly = restoreOnlyValue === "true";
if (restoreOnly && loadEmployeeCount !== undefined && loadEmployeeCount !== "0") {
  throw new Error("NOVA_QA_RESTORE_ONLY_CANNOT_RUN_WORKLOAD");
}
function optionalBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_MUST_BE_BETWEEN_${minimum}_AND_${maximum}`);
  }
  return parsed;
}
const employeeCount = Number(loadEmployeeCount ?? "0");
const loadConcurrency = optionalBoundedInteger("NOVA_QA_LOAD_CONCURRENCY", Math.max(1, Math.min(25, employeeCount)), 1, 200);
const tasksPerEmployee = optionalBoundedInteger("NOVA_QA_LOAD_TASKS_PER_EMPLOYEE", 1, 1, 10);
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
  console.info(`Optional in-process DB-backed workload: ${loadEmployeeCount} employees, ${tasksPerEmployee} task(s) each, at most ${loadConcurrency} concurrent requests; not a hosted SLA.`);
}
if (qaDbPoolMax || qaAuthPoolMax) {
  console.info(`QA pool profile: database=${qaDbPoolMax ?? "configured default"}, auth=${qaAuthPoolMax ?? "configured default"}`);
}
if (qaRequestScoped) {
  console.info("QA profile: request-scoped direct PostgreSQL clients; this local test does not include Hyperdrive pooling");
}
if (restoreOnly) console.info("QA profile: restore-only; applies all migrations, checks app-role preflight, then runs the isolated dump/restore rehearsal.");

// Keep the QA network run-scoped and isolated. Docker's default address pool
// can be exhausted by retained diagnostic projects; choose a private /24 only
// after checking Docker, Windows, and (when used) WSL route tables.
const composeEnvironment: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(composeEnvironment)) {
  if (key.startsWith("NOVA_") || key.startsWith("BETTER_AUTH_") ||
      key === "DATABASE_URL" || key === "MIGRATOR_DATABASE_URL" || key === "SUPABASE_ACCESS_TOKEN") {
    delete composeEnvironment[key];
  }
}
const dockerProbe = process.platform === "win32"
  ? spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8", cwd: repositoryRoot, env: composeEnvironment,
  })
  : undefined;
const useWslDocker = process.platform === "win32" &&
  (dockerProbe?.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
const qaNetworkName = `${projectName}_isolated`;

function docker(args: string[], useWsl: boolean) {
  return useWsl
    ? spawnSync("wsl.exe", ["-e", "docker", ...args], { cwd: repositoryRoot, encoding: "utf8", env: composeEnvironment })
    : spawnSync("docker", args, { cwd: repositoryRoot, encoding: "utf8", env: composeEnvironment });
}

function parseIpv4Range(value: string): { first: bigint; last: bigint } | undefined {
  if (value === "default" || value.includes(":")) return undefined;
  const [address, prefixText] = value.split("/");
  const octets = address?.split(".");
  if (!octets || octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) {
    return undefined;
  }
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || prefix === 0) return undefined;
  const addressValue = octets.reduce((valueSoFar, octet) => (valueSoFar << 8n) | BigInt(Number(octet)), 0n);
  const size = 1n << BigInt(32 - prefix);
  const first = (addressValue / size) * size;
  return { first, last: first + size - 1n };
}

function routeValues(json: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("LOCAL_POSTGRES_QA_ROUTE_INVENTORY_INVALID"); }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object") {
      const destination = (value as { dst?: unknown }).dst;
      return typeof destination === "string" ? [destination] : [];
    }
    return [];
  });
}

function successfulOutput(result: ReturnType<typeof spawnSync>, code: string): string {
  if (result.error || result.status !== 0) throw new Error(code);
  return (typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "").trim();
}

async function chooseQaSubnet(): Promise<string> {
  const networkList = docker(["network", "ls", "--quiet"], useWslDocker);
  const networkIds = successfulOutput(networkList, "LOCAL_POSTGRES_QA_DOCKER_NETWORK_INVENTORY_FAILED")
    .split(/\s+/).filter(Boolean);
  const dockerRanges: string[] = [];
  if (networkIds.length > 0) {
    const inspection = docker(["network", "inspect", ...networkIds], useWslDocker);
    const networks = JSON.parse(successfulOutput(inspection, "LOCAL_POSTGRES_QA_DOCKER_NETWORK_INSPECTION_FAILED")) as Array<{
      IPAM?: { Config?: Array<{ Subnet?: string }> };
    }>;
    for (const network of networks) {
      for (const configuration of network.IPAM?.Config ?? []) {
        if (configuration.Subnet) dockerRanges.push(configuration.Subnet);
      }
    }
  }

  const hostRoutes: string[] = [];
  if (process.platform === "win32") {
    const windowsRoutes = spawnSync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference = 'Stop'; Get-NetRoute -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty DestinationPrefix -Unique | ConvertTo-Json -Compress",
    ], { encoding: "utf8", cwd: repositoryRoot, env: composeEnvironment });
    hostRoutes.push(...routeValues(successfulOutput(windowsRoutes, "LOCAL_POSTGRES_QA_WINDOWS_ROUTE_INVENTORY_FAILED")));
    if (useWslDocker) {
      const wslRoutes = spawnSync("wsl.exe", ["-e", "ip", "-j", "route", "show", "table", "all"], {
        encoding: "utf8", cwd: repositoryRoot, env: composeEnvironment,
      });
      hostRoutes.push(...routeValues(successfulOutput(wslRoutes, "LOCAL_POSTGRES_QA_WSL_ROUTE_INVENTORY_FAILED")));
    }
  } else {
    const localRoutes = spawnSync("ip", ["-j", "route", "show", "table", "all"], {
      encoding: "utf8", cwd: repositoryRoot, env: composeEnvironment,
    });
    hostRoutes.push(...routeValues(successfulOutput(localRoutes, "LOCAL_POSTGRES_QA_HOST_ROUTE_INVENTORY_FAILED")));
  }

  const occupied = [...dockerRanges, ...hostRoutes].flatMap((prefix) => {
    const range = parseIpv4Range(prefix);
    return range ? [range] : [];
  });
  const startingOffset = randomBytes(1)[0]!;
  for (let offset = 0; offset < 256; offset += 1) {
    const subnet = `10.240.${(startingOffset + offset) % 256}.0/24`;
    const candidate = parseIpv4Range(subnet)!;
    if (!occupied.some((range) => candidate.first <= range.last && range.first <= candidate.last)) return subnet;
  }
  throw new Error("LOCAL_POSTGRES_QA_NO_SAFE_PRIVATE_SUBNET_FOUND");
}

const qaSubnet = await chooseQaSubnet();
console.info(`Run-scoped Docker QA network selected at ${qaSubnet}; verified outside current Docker and host routes.`);

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
  NOVA_QA_LOAD_CONCURRENCY: String(loadConcurrency),
  NOVA_QA_LOAD_TASKS_PER_EMPLOYEE: String(tasksPerEmployee),
  NOVA_QA_REQUEST_SCOPED: qaRequestScoped ? "true" : "false",
  NOVA_QA_RESTORE_ONLY: restoreOnly ? "true" : "false",
  NOVA_QA_NETWORK: qaNetworkName,
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
  const isolatedNetwork = docker([
    "network", "create", "--driver", "bridge", "--subnet", qaSubnet,
    "--label", `nova.qa.project=${projectName}`,
    "--label", "nova.qa.purpose=isolated-postgres-test",
    qaNetworkName,
  ], useWslDocker);
  if (isolatedNetwork.error || isolatedNetwork.status !== 0) {
    throw new Error("LOCAL_POSTGRES_QA_ISOLATED_NETWORK_CREATE_FAILED");
  }

  if (useWslDocker) {
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
    const native = spawnSync("docker", [...composePrefix(), "--profile", "qa", "run", "--build", "--rm", "qa"], {
      cwd: repositoryRoot,
      stdio: "inherit",
      env: composeEnvironment,
    });
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
  const inspectedNetwork = docker(["network", "inspect", qaNetworkName], useWsl);
  if (inspectedNetwork.error || inspectedNetwork.status !== 0) {
    console.error(`QA_NETWORK_INSPECT_FAILED_${projectName}; isolated network was retained.`);
    process.exitCode = 1;
    return;
  }
  const network = (JSON.parse(inspectedNetwork.stdout) as Array<{
    Name?: string;
    Labels?: Record<string, string>;
    IPAM?: { Config?: Array<{ Subnet?: string }> };
    Containers?: Record<string, unknown>;
  }>)[0];
  if (network?.Name !== qaNetworkName ||
      network.Labels?.["nova.qa.project"] !== projectName ||
      network.Labels?.["nova.qa.purpose"] !== "isolated-postgres-test" ||
      !network.IPAM?.Config?.some(({ Subnet }) => Subnet === qaSubnet) ||
      Object.keys(network.Containers ?? {}).length > 0) {
    console.error(`QA_NETWORK_IDENTITY_MISMATCH_${projectName}; isolated network was retained.`);
    process.exitCode = 1;
    return;
  }
  const removedNetwork = docker(["network", "rm", qaNetworkName], useWsl);
  if (removedNetwork.error || removedNetwork.status !== 0) {
    console.error(`QA_NETWORK_REMOVAL_FAILED_${projectName}; isolated network was retained.`);
    process.exitCode = 1;
    return;
  }
  console.info("Isolated QA containers, verified run-scoped network, PostgreSQL data, and TLS volumes removed.");
}
