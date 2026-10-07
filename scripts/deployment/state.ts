import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DeploymentPreview } from "./plan.ts";

const planIdPattern = /^plan-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const maxPlanAgeMs = 24 * 60 * 60 * 1000;

export interface StoredDeploymentPlan {
  schemaVersion: 1;
  id: string;
  repoRoot: string;
  createdAt: string;
  expiresAt: string;
  preview: Omit<DeploymentPreview, "previewId" | "persisted"> & { previewId: string; persisted: true };
}

function stateDirectory(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error("DEPLOYMENT_STATE_DIRECTORY_UNAVAILABLE");
    return join(localAppData, "NOVA", "deployment-manager");
  }
  const stateHome = process.env.XDG_STATE_HOME;
  return stateHome
    ? join(stateHome, "nova", "deployment-manager")
    : join(homedir(), ".local", "state", "nova", "deployment-manager");
}

function repoKey(repoRoot: string): string {
  const normalized = resolve(repoRoot).replace(/[\\/]+$/, "");
  const identity = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

async function ensureRepoDirectory(repoRoot: string): Promise<string> {
  const directory = join(resolve(stateDirectory()), repoKey(repoRoot));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

function validatePlan(value: unknown, repoRoot: string, expectedId: string): StoredDeploymentPlan {
  const corrupt = (): never => { throw new Error("DEPLOYMENT_PLAN_CORRUPT: preserve the file and inspect it before retrying"); };
  const hasOnly = (record: Record<string, unknown>, allowed: readonly string[]) =>
    Object.keys(record).every((key) => allowed.includes(key));
  if (typeof value !== "object" || value === null || Array.isArray(value)) return corrupt();
  const record = value as Record<string, unknown>;
  if (!hasOnly(record, ["schemaVersion", "id", "repoRoot", "createdAt", "expiresAt", "preview"]) ||
      record.schemaVersion !== 1 || record.id !== expectedId || !planIdPattern.test(String(record.id)) ||
      typeof record.repoRoot !== "string" || (process.platform === "win32"
        ? resolve(record.repoRoot).toLowerCase() !== resolve(repoRoot).toLowerCase()
        : resolve(record.repoRoot) !== resolve(repoRoot)) ||
      typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.expiresAt) <= Date.parse(record.createdAt) ||
      Date.parse(record.expiresAt) - Date.parse(record.createdAt) > maxPlanAgeMs ||
      typeof record.preview !== "object" || record.preview === null || Array.isArray(record.preview)) return corrupt();
  const preview = record.preview as Record<string, unknown>;
  const source = preview.source as Record<string, unknown> | undefined;
  const request = preview.request as Record<string, unknown> | undefined;
  const localHints = preview.localHints as Record<string, unknown> | undefined;
  const database = localHints?.database as Record<string, unknown> | undefined;
  const actions = preview.actions as unknown[] | undefined;
  const providerInventory = preview.providerInventory as unknown[] | undefined;
  const validRuntime = (value: unknown) => value === null || ["netlify", "cloudflare", "vercel", "vps"].includes(String(value));
  const validScheduler = (value: unknown) => value === null || ["cloudflare", "netlify", "vercel", "supabase", "vps"].includes(String(value));
  if (preview.persisted !== true || preview.applyEnabled !== false ||
      !hasOnly(preview, ["previewId", "persisted", "applyEnabled", "request", "source", "localHints", "actions", "blockers", "providerInventory"]) ||
      typeof preview.previewId !== "string" || preview.previewId !== record.id ||
      !request || !hasOnly(request, ["runtime", "database", "scheduler"]) ||
      !["netlify", "cloudflare", "vercel", "vps"].includes(String(request.runtime)) ||
      !["keep", "provision-supabase", "move"].includes(String(request.database)) ||
      !["keep", "cloudflare", "netlify", "vercel", "supabase", "vps"].includes(String(request.scheduler)) ||
      !source || typeof source.commit !== "string" || !commitPattern.test(source.commit) ||
      !hasOnly(source, ["branch", "commit", "clean"]) || typeof source.clean !== "boolean" ||
      (source.branch !== null && typeof source.branch !== "string") ||
      !localHints || !hasOnly(localHints, ["runtimeHint", "database", "schedulerHint"]) ||
      !validRuntime(localHints.runtimeHint) || !validScheduler(localHints.schedulerHint) ||
      !database || !hasOnly(database, ["configured", "providerHint", "projectRef", "endpointLabel"]) ||
      typeof database.configured !== "boolean" ||
      !["supabase", "postgresql", "unknown"].includes(String(database.providerHint)) ||
      (database.projectRef !== undefined && (typeof database.projectRef !== "string" || !/^[a-z0-9]{20}$/.test(database.projectRef))) ||
      (database.endpointLabel !== undefined && typeof database.endpointLabel !== "string") ||
      !Array.isArray(actions) || !actions.every((item) => {
        const action = typeof item === "object" && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : null;
        return action !== null && hasOnly(action, ["id", "resource", "operation", "execution", "reason"]) &&
          typeof action.id === "string" && typeof action.operation === "string" &&
          ["source", "runtime", "database", "scheduler", "domain", "secrets"].includes(String(action.resource)) &&
          ["locally-verified", "provider-inventory-required", "not-implemented"].includes(String(action.execution)) &&
          (action.reason === undefined || typeof action.reason === "string");
      }) || !Array.isArray(preview.blockers) || !preview.blockers.every((item) => typeof item === "string") ||
      (providerInventory !== undefined && (!Array.isArray(providerInventory) || !providerInventory.every((item) => {
        const provider = typeof item === "object" && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : null;
        return provider !== null && hasOnly(provider, ["provider", "state", "target", "runtime", "release", "origin", "databaseVersion", "databaseFingerprint", "schemaReady", "migrationLedgerPresent", "configuredScheduler", "schedulerInventory", "detail"]) &&
          ["netlify", "cloudflare", "vercel", "supabase", "nova"].includes(String(provider.provider)) &&
          ["identified", "target-required", "not-configured", "unavailable"].includes(String(provider.state)) &&
          ["target", "runtime", "release", "origin", "databaseVersion", "detail"].every((key) => provider[key] === undefined || typeof provider[key] === "string") &&
          (provider.configuredScheduler === undefined || ["cloudflare", "netlify", "vercel", "supabase", "vps"].includes(String(provider.configuredScheduler))) &&
          (provider.databaseFingerprint === undefined || (typeof provider.databaseFingerprint === "string" && /^[a-f0-9]{64}$/.test(provider.databaseFingerprint))) &&
          ["schemaReady", "migrationLedgerPresent"].every((key) => provider[key] === undefined || typeof provider[key] === "boolean") &&
          (provider.schedulerInventory === undefined || (() => {
            const scheduler = typeof provider.schedulerInventory === "object" && provider.schedulerInventory !== null && !Array.isArray(provider.schedulerInventory)
              ? provider.schedulerInventory as Record<string, unknown> : null;
            return scheduler !== null && hasOnly(scheduler, ["scope", "state", "completeness", "triggers", "detail"]) &&
              ["target-runtime", "database-project"].includes(String(scheduler.scope)) &&
              ["verified", "not-installed", "target-required", "unavailable"].includes(String(scheduler.state)) &&
              ["resource-only", "project-scoped", "partial", "not-inspected"].includes(String(scheduler.completeness)) &&
              (scheduler.detail === undefined || typeof scheduler.detail === "string") && Array.isArray(scheduler.triggers) &&
              scheduler.triggers.every((value) => {
                const trigger = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
                return trigger !== null && hasOnly(trigger, ["id", "name", "schedule", "active"]) &&
                  typeof trigger.id === "string" && typeof trigger.name === "string" &&
                  (trigger.schedule === null || typeof trigger.schedule === "string") &&
                  (trigger.active === null || typeof trigger.active === "boolean");
              });
          })());
      })))) return corrupt();
  return value as StoredDeploymentPlan;
}

/** Store durable plans outside the checkout and never store provider credentials. */
export async function saveDeploymentPlan(
  repoRoot: string,
  preview: DeploymentPreview,
  now = new Date(),
): Promise<StoredDeploymentPlan> {
  const directory = await ensureRepoDirectory(repoRoot);
  const id = `plan-${randomUUID()}`;
  const createdAt = now.toISOString();
  const stored: StoredDeploymentPlan = {
    schemaVersion: 1,
    id,
    repoRoot: resolve(repoRoot),
    createdAt,
    expiresAt: new Date(now.getTime() + maxPlanAgeMs).toISOString(),
    preview: { ...preview, previewId: id, persisted: true },
  };
  const path = join(directory, `${id}.json`);
  const temporary = join(directory, `${id}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") await chmod(temporary, 0o600);
  try {
    // Hard-link publication is atomic and fails if a destination already exists.
    await link(temporary, path);
    await rm(temporary, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error((error as NodeJS.ErrnoException).code === "EEXIST"
      ? "DEPLOYMENT_PLAN_ID_COLLISION"
      : "DEPLOYMENT_PLAN_SAVE_FAILED");
  }
  if (process.platform !== "win32") await chmod(path, 0o600);
  return stored;
}

export async function loadDeploymentPlan(
  repoRoot: string,
  id: string,
  options: { allowExpired?: boolean } = {},
): Promise<StoredDeploymentPlan> {
  if (!planIdPattern.test(id)) throw new Error("DEPLOYMENT_PLAN_ID_INVALID");
  const path = join(await ensureRepoDirectory(repoRoot), `${id}.json`);
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === "ENOENT" ? "DEPLOYMENT_PLAN_NOT_FOUND" : "DEPLOYMENT_PLAN_READ_FAILED");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("DEPLOYMENT_PLAN_CORRUPT: preserve the file and inspect it before retrying"); }
  const plan = validatePlan(parsed, repoRoot, id);
  if (!options.allowExpired && Date.parse(plan.expiresAt) < Date.now()) {
    throw new Error("DEPLOYMENT_PLAN_EXPIRED: create and review a fresh plan");
  }
  return plan;
}

export async function acquireDeploymentLock(repoRoot: string): Promise<() => Promise<void>> {
  const directory = await ensureRepoDirectory(repoRoot);
  const path = join(directory, "deployment.lock");
  const id = randomUUID();
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === "EEXIST"
      ? "DEPLOYMENT_OPERATION_ALREADY_RUNNING_OR_STALE_LOCK"
      : "DEPLOYMENT_LOCK_CREATE_FAILED");
  }
  await handle.writeFile(JSON.stringify({ id, pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.close();
  return async () => {
    try {
      const current = JSON.parse(await readFile(path, "utf8")) as { id?: unknown };
      if (current.id === id) await rm(path, { force: true });
    } catch { /* Preserve uncertain locks for manual recovery. */ }
  };
}
