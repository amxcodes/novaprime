import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const knownServices = new Set([
  "postgres", "postgres-qa", "migrate", "api", "nginx", "maintenance", "qa",
]);
const serviceStates = new Set([
  "created", "running", "restarting", "paused", "exited", "dead", "removing",
]);
const healthStates = new Set(["healthy", "unhealthy", "starting"]);
const dockerEnvironmentKeys = new Set([
  "PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME",
  "DOCKER_CONFIG", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
]);

export interface DockerComposeServiceStatus {
  service: string;
  state: string;
  health: string | null;
  exitCode: number | null;
}

export interface DockerComposeInventory {
  state: "verified" | "unavailable";
  services: DockerComposeServiceStatus[];
  detail?: "DOCKER_CLI_NOT_FOUND" | "DOCKER_STATUS_TIMEOUT" | "DOCKER_COMPOSE_UNAVAILABLE" | "DOCKER_COMPOSE_OUTPUT_INVALID";
}

function outputRows(output: string): unknown[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try { return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown); }
    catch { throw new Error("DOCKER_COMPOSE_OUTPUT_INVALID"); }
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseDockerComposePsOutput(output: string): DockerComposeServiceStatus[] {
  return outputRows(output).flatMap((value) => {
    const row = objectRecord(value);
    if (!row) throw new Error("DOCKER_COMPOSE_OUTPUT_INVALID");
    const rawService = row.Service ?? row.service;
    if (typeof rawService !== "string" || !knownServices.has(rawService)) return [];
    const rawState = row.State ?? row.state;
    const state = typeof rawState === "string" && serviceStates.has(rawState.toLowerCase())
      ? rawState.toLowerCase()
      : "unknown";
    const rawHealth = row.Health ?? row.health;
    const health = typeof rawHealth === "string" && healthStates.has(rawHealth.toLowerCase())
      ? rawHealth.toLowerCase()
      : null;
    const rawExitCode = row.ExitCode ?? row.exitCode;
    const exitCode = typeof rawExitCode === "number" && Number.isSafeInteger(rawExitCode)
      ? rawExitCode
      : null;
    return [{ service: rawService, state, health, exitCode }];
  }).sort((left, right) => left.service.localeCompare(right.service));
}

async function runComposeStatus(repoRoot: string): Promise<string> {
  const root = resolve(repoRoot);
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => value !== undefined && dockerEnvironmentKeys.has(key)));
  const { stdout } = await execFileAsync("docker", [
    "compose", "--project-directory", root, "--file", resolve(root, "docker", "compose.yaml"),
    "ps", "--all", "--format", "json",
  ], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 3_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export async function inspectDockerCompose(
  repoRoot: string,
  run: (root: string) => Promise<string> = runComposeStatus,
): Promise<DockerComposeInventory> {
  try {
    return { state: "verified", services: parseDockerComposePsOutput(await run(resolve(repoRoot))) };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    const detail = error instanceof Error && error.message === "DOCKER_COMPOSE_OUTPUT_INVALID"
      ? "DOCKER_COMPOSE_OUTPUT_INVALID"
      : code === "ENOENT"
        ? "DOCKER_CLI_NOT_FOUND"
        : code === "ETIMEDOUT"
          ? "DOCKER_STATUS_TIMEOUT"
          : "DOCKER_COMPOSE_UNAVAILABLE";
    return { state: "unavailable", services: [], detail };
  }
}
