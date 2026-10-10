import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { databaseIdentityFingerprint } from "../../server/src/deployment-identity.ts";
import { inspectDockerCompose, type DockerComposeInventory } from "./docker-inventory.ts";

const execFileAsync = promisify(execFile);
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const projectRefPattern = /^[a-z0-9]{20}$/;
export const deploymentProviderCredentialKeys = [
  "NETLIFY_AUTH_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "VERCEL_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
] as const;

export type RuntimeAdapter = "netlify" | "cloudflare" | "vercel" | "vps";
export type SchedulerAdapter = "cloudflare" | "netlify" | "vercel" | "supabase" | "vps";

export interface SourceInventory {
  branch: string | null;
  commit: string;
  clean: boolean;
  dirtyPathCount: number;
  packageVersion: string | null;
}

export interface DatabaseInventory {
  configured: boolean;
  providerHint: "supabase" | "postgresql" | "unknown";
  projectRef?: string;
  endpointLabel?: string;
  identityFingerprint?: string;
}

export interface LocalDeploymentInventory {
  environmentSource: string;
  source: SourceInventory;
  runtimeHint: RuntimeAdapter | null;
  database: DatabaseInventory;
  schedulerHint: SchedulerAdapter | null;
  dockerCompose?: DockerComposeInventory;
  secretPresence: Readonly<Record<string, boolean>>;
  providerCredentialPresence: Readonly<Record<string, boolean>>;
}

export interface LocalDeploymentInspectionOptions {
  /** Use the selected configuration file when identifying the local Compose project. */
  environmentFilePath?: string;
  composeInspector?: typeof inspectDockerCompose;
}

function safeRuntime(value: string | undefined): RuntimeAdapter | null {
  if (value === "netlify" || value === "cloudflare" || value === "vercel" || value === "vps") return value;
  return null;
}

function safeScheduler(value: string | undefined): SchedulerAdapter | null {
  if (value === "cloudflare" || value === "netlify" || value === "vercel" || value === "supabase" || value === "vps") return value;
  return null;
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  } catch {
    throw new Error("DEPLOYMENT_SOURCE_INSPECTION_FAILED");
  }
}

export async function inspectLocalDeployment(
  repoRoot: string,
  environment: Readonly<Record<string, string>>,
  environmentSource: string,
  options: LocalDeploymentInspectionOptions = {},
): Promise<LocalDeploymentInventory> {
  const root = resolve(repoRoot);
  const [reportedRoot, commit, branch, status] = await Promise.all([
    git(root, ["rev-parse", "--show-toplevel"]),
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  if (resolve(reportedRoot).toLowerCase() !== root.toLowerCase() || !commitPattern.test(commit)) {
    throw new Error("DEPLOYMENT_SOURCE_REPOSITORY_MISMATCH");
  }

  let packageVersion: string | null = null;
  try {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version)) {
      packageVersion = packageJson.version;
    }
  } catch {
    packageVersion = null;
  }

  const connection = environment.DATABASE_URL;
  let database: DatabaseInventory = { configured: Boolean(connection), providerHint: "unknown" };
  if (connection) {
    try {
      const url = new URL(connection);
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        throw new Error("INVALID_DATABASE_URL");
      }
      const fromDirectHost = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname)?.[1]?.toLowerCase();
      const fromPoolerUser = url.hostname.toLowerCase().endsWith(".pooler.supabase.com")
        ? decodeURIComponent(url.username).toLowerCase().split(".").at(-1)
        : undefined;
      const configuredRef = environment.NOVA_SUPABASE_PROJECT_REF;
      const verifiedConfiguredRef = configuredRef && projectRefPattern.test(configuredRef) ? configuredRef : undefined;
      const urlProjectRef = fromDirectHost ?? (fromPoolerUser && projectRefPattern.test(fromPoolerUser) ? fromPoolerUser : undefined);
      if (verifiedConfiguredRef && urlProjectRef && verifiedConfiguredRef !== urlProjectRef) {
        throw new Error("DATABASE_PROJECT_REF_MISMATCH");
      }
      const projectRef = urlProjectRef ?? verifiedConfiguredRef;
      const identityFingerprint = databaseIdentityFingerprint(connection, verifiedConfiguredRef);
      const databaseName = decodeURIComponent(url.pathname.slice(1));
      const port = url.port || "5432";
      const host = url.hostname.includes(":") ? "[" + url.hostname + "]" : url.hostname;
      database = {
        configured: true,
        providerHint: projectRef ? "supabase" : "postgresql",
        ...(projectRef ? { projectRef } : {}),
        ...(identityFingerprint ? { identityFingerprint } : {}),
        endpointLabel: projectRef
          ? "Supabase project " + projectRef
          : "PostgreSQL " + host + ":" + port + "/" + (databaseName || "(default database)"),
      };
    } catch {
      database = { configured: true, providerHint: "unknown" };
    }
  }

  const secretKeys = [
    "BETTER_AUTH_SECRET",
    "NOVA_SECRETS_ENCRYPTION_KEY",
    "NOVA_BACKGROUND_JOB_SECRET",
    "NOVA_BOOTSTRAP_TOKEN",
  ] as const;
  const runtimeHint = safeRuntime(environment.NOVA_RUNTIME_ADAPTER);
  const schedulerHint = safeScheduler(environment.NOVA_BACKGROUND_SCHEDULER);
  const composeInspector = options.composeInspector ?? inspectDockerCompose;
  const dockerCompose = runtimeHint === "vps" || schedulerHint === "vps"
    ? await composeInspector(root, { environmentFilePath: options.environmentFilePath })
    : undefined;
  return {
    environmentSource,
    source: {
      branch: branch || null,
      commit,
      clean: status.length === 0,
      dirtyPathCount: status ? status.split("\n").length : 0,
      packageVersion,
    },
    runtimeHint,
    database,
    schedulerHint,
    ...(dockerCompose ? { dockerCompose } : {}),
    secretPresence: Object.fromEntries(secretKeys.map((key) => [key, Boolean(environment[key])])),
    providerCredentialPresence: Object.fromEntries(deploymentProviderCredentialKeys.map((key) => [key, Boolean(environment[key])])),
  };
}
