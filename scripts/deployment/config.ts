import { readFile } from "node:fs/promises";
import { resolveSetupEnvironmentPath } from "../setup-env-path.ts";

const keyPattern = /^[A-Z0-9_]+$/;

export type DeploymentEnvironment = Readonly<Record<string, string>>;

/** Parse the simple KEY=value format written by NOVA setup without expansion. */
export function parseDeploymentEnvironment(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^\s*([A-Z0-9_]+)=(.*)\s*$/.exec(line);
    if (!match) throw new Error("DEPLOYMENT_ENV_LINE_INVALID:" + (index + 1));
    const [, key, rawValue] = match;
    if (!keyPattern.test(key!)) throw new Error("DEPLOYMENT_ENV_KEY_INVALID:" + (index + 1));
    if (Object.hasOwn(values, key!)) throw new Error("DEPLOYMENT_ENV_DUPLICATE_KEY:" + key);
    const value = rawValue!;
    const first = value[0];
    const last = value.at(-1);
    if ((first === "'" || first === '"') && last !== first) {
      throw new Error("DEPLOYMENT_ENV_QUOTE_INVALID:" + key);
    }
    values[key!] = (first === "'" || first === '"') ? value.slice(1, -1) : value;
  }
  return values;
}

/** Read only a user-selected file contained by this checkout; never follow .env symlinks. */
export async function readDeploymentEnvironmentFile(
  repoRoot: string,
  configuredPath: string,
): Promise<{ path: string; values: Record<string, string> }> {
  let path: string;
  try {
    path = resolveSetupEnvironmentPath(repoRoot, configuredPath);
  } catch (error) {
    const code = error instanceof Error && /^SETUP_ENV_FILE_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "SETUP_ENV_FILE_UNAVAILABLE";
    throw new Error("DEPLOYMENT_" + code);
  }
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new Error("DEPLOYMENT_ENV_FILE_UNREADABLE");
  }
  return { path, values: parseDeploymentEnvironment(source) };
}

const deploymentConfigurationPattern = /^(?:DATABASE_URL|MIGRATOR_DATABASE_URL|SUPABASE_ACCESS_TOKEN|NOVA_[A-Z0-9_]+|BETTER_AUTH_[A-Z0-9_]+|NETLIFY_AUTH_TOKEN|NETLIFY_SITE_ID|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_WORKER_NAME|VERCEL_TOKEN|VERCEL_PROJECT_ID|VERCEL_TEAM_ID)$/;

/** Retain OS process essentials while excluding ambient NOVA/provider secrets. */
export function environmentForDeploymentConfig(
  processEnvironment: NodeJS.ProcessEnv,
  selectedEnvironment?: DeploymentEnvironment,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnvironment)) {
    if (value !== undefined && !deploymentConfigurationPattern.test(key)) output[key] = value;
  }
  for (const [key, value] of Object.entries(selectedEnvironment ?? {})) output[key] = value;
  return output;
}
