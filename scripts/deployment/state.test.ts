import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeploymentPreview } from "./plan.ts";
import type { LocalDeploymentInventory } from "./inventory.ts";
import { loadDeploymentPlan, saveDeploymentPlan } from "./state.ts";

const originalLocalAppData = process.env.LOCALAPPDATA;
const originalXdgStateHome = process.env.XDG_STATE_HOME;
let temporaryRoot: string | undefined;
afterEach(async () => {
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgStateHome;
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

function setStateHome(path: string): void {
  if (process.platform === "win32") {
    process.env.LOCALAPPDATA = path;
    delete process.env.XDG_STATE_HOME;
  } else {
    process.env.XDG_STATE_HOME = path;
    delete process.env.LOCALAPPDATA;
  }
}

function stateRoot(): string {
  return process.platform === "win32"
    ? join(process.env.LOCALAPPDATA!, "NOVA", "deployment-manager")
    : join(process.env.XDG_STATE_HOME!, "nova", "deployment-manager");
}

const inventory: LocalDeploymentInventory = {
  environmentSource: "test",
  source: { branch: "main", commit: "a".repeat(40), clean: true, dirtyPathCount: 0, packageVersion: "1.2.3" },
  runtimeHint: "netlify",
  database: { configured: true, providerHint: "supabase", projectRef: "abcdefghijklmnopqrst", endpointLabel: "Supabase project abcdefghijklmnopqrst" },
  schedulerHint: "supabase",
  secretPresence: { DATABASE_URL: true },
  providerCredentialPresence: { SUPABASE_ACCESS_TOKEN: true },
};

test("plans persist outside the checkout with a random ID and private file mode", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "nova-deployment-plan-"));
  setStateHome(join(temporaryRoot, "state"));
  const repo = join(temporaryRoot, "repo");
  const preview = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "supabase" }, [
    {
      provider: "cloudflare" as const,
      state: "identified" as const,
      target: "account/worker",
      revision: "worker-etag-123",
      runtimeBindings: {
        state: "verified" as const,
        completeness: "selected-runtime" as const,
        bindings: [{ name: "HYPERDRIVE", type: "hyperdrive", scopes: ["worker"], contexts: ["production"], secret: false }],
        configuredScheduler: "supabase",
      },
      domainRoutes: {
        state: "verified" as const,
        completeness: "selected-runtime" as const,
        domains: [{ hostname: "nova.example.test", source: "custom-domain" as const }],
      },
    },
    {
      provider: "supabase" as const,
      state: "identified" as const,
      target: "abcdefghijklmnopqrst",
      schedulerInventory: {
        scope: "database-project" as const,
        state: "verified" as const,
        completeness: "project-scoped" as const,
        triggers: [{ id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }],
      },
      migrationInventory: {
        state: "current" as const,
        appliedCount: 79,
        migrationHead: "0079_permission_customer_role_assignability.sql",
        expectedHead: "0079_permission_customer_role_assignability.sql",
        checksumsVerified: true,
      },
    },
  ]);
  const stored = await saveDeploymentPlan(repo, preview, new Date());
  expect(stored.id).toMatch(/^plan-[0-9a-f-]{36}$/i);
  expect(stored.preview).toMatchObject({ persisted: true, applyEnabled: false, previewId: stored.id });
  expect(await loadDeploymentPlan(repo, stored.id)).toEqual(stored);
  const root = stateRoot();
  const hashDirs = await readdir(root);
  expect(hashDirs).toHaveLength(1);
  const files = await readdir(join(root, hashDirs[0]!));
  expect(files).toEqual([`${stored.id}.json`]);
  expect(JSON.stringify(stored)).not.toContain("SUPABASE_ACCESS_TOKEN");
  expect(JSON.stringify(stored)).not.toContain("DATABASE_URL");
  const persistedPath = join(root, (await readdir(root))[0]!, `${stored.id}.json`);
  const editedPlan = JSON.parse(await readFile(persistedPath, "utf8")) as Record<string, unknown>;
  const persistedPreview = editedPlan.preview as { providerInventory: Array<Record<string, unknown>> };
  const cloudflare = persistedPreview.providerInventory.find(({ provider }) => provider === "cloudflare")!;
  const runtimeBindings = cloudflare.runtimeBindings as { bindings: Array<Record<string, unknown>> };
  runtimeBindings.bindings[0]!.value = "must-not-enter-plan-state";
  await writeFile(persistedPath, JSON.stringify(editedPlan));
  await expect(loadDeploymentPlan(repo, stored.id)).rejects.toThrow("DEPLOYMENT_PLAN_CORRUPT");
  if (process.platform !== "win32") {
    const info = await stat(join(root, hashDirs[0]!, `${stored.id}.json`));
    expect(info.mode & 0o777).toBe(0o600);
  }
});

test("plan loading is bound to the checkout, expires, and rejects added credential fields", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "nova-deployment-expiry-"));
  setStateHome(join(temporaryRoot, "state"));
  const repo = join(temporaryRoot, "repo");
  const preview = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "supabase" });
  const stored = await saveDeploymentPlan(repo, preview, new Date(Date.now() - 48 * 60 * 60 * 1000));
  await expect(loadDeploymentPlan(repo, stored.id)).rejects.toThrow("DEPLOYMENT_PLAN_EXPIRED");
  await expect(loadDeploymentPlan(join(temporaryRoot, "other-repo"), stored.id)).rejects.toThrow("DEPLOYMENT_PLAN_NOT_FOUND");

  const fresh = await saveDeploymentPlan(repo, preview);
  const root = stateRoot();
  const hashDirs = await readdir(root);
  let path = "";
  for (const hashDir of hashDirs) {
    const candidate = join(root, hashDir, `${fresh.id}.json`);
    try { await readFile(candidate); path = candidate; break; }
    catch { /* This directory belongs to another checkout in the test. */ }
  }
  expect(path).not.toBe("");
  const edited = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  edited.SUPABASE_ACCESS_TOKEN = "unexpected credential";
  await writeFile(path, JSON.stringify(edited));
  await expect(loadDeploymentPlan(repo, fresh.id)).rejects.toThrow("DEPLOYMENT_PLAN_CORRUPT");
});
