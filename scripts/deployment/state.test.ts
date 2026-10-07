import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeploymentPreview } from "./plan.ts";
import type { LocalDeploymentInventory } from "./inventory.ts";
import { loadDeploymentPlan, saveDeploymentPlan } from "./state.ts";

const originalLocalAppData = process.env.LOCALAPPDATA;
let temporaryRoot: string | undefined;
afterEach(async () => {
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

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
  process.env.LOCALAPPDATA = join(temporaryRoot, "state");
  const repo = join(temporaryRoot, "repo");
  const preview = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "supabase" });
  const stored = await saveDeploymentPlan(repo, preview, new Date("2026-10-07T00:00:00.000Z"));
  expect(stored.id).toMatch(/^plan-[0-9a-f-]{36}$/i);
  expect(stored.preview).toMatchObject({ persisted: true, applyEnabled: false, previewId: stored.id });
  expect(await loadDeploymentPlan(repo, stored.id)).toEqual(stored);
  const stateRoot = join(process.env.LOCALAPPDATA!, "NOVA", "deployment-manager");
  const hashDirs = await readdir(stateRoot);
  expect(hashDirs).toHaveLength(1);
  const files = await readdir(join(stateRoot, hashDirs[0]!));
  expect(files).toEqual([`${stored.id}.json`]);
  expect(JSON.stringify(stored)).not.toContain("SUPABASE_ACCESS_TOKEN");
  expect(JSON.stringify(stored)).not.toContain("DATABASE_URL");
  if (process.platform !== "win32") {
    const info = await stat(join(stateRoot, hashDirs[0]!, `${stored.id}.json`));
    expect(info.mode & 0o777).toBe(0o600);
  }
});

test("plan loading is bound to the checkout, expires, and rejects added credential fields", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "nova-deployment-expiry-"));
  process.env.LOCALAPPDATA = join(temporaryRoot, "state");
  const repo = join(temporaryRoot, "repo");
  const preview = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "supabase" });
  const stored = await saveDeploymentPlan(repo, preview, new Date(Date.now() - 48 * 60 * 60 * 1000));
  await expect(loadDeploymentPlan(repo, stored.id)).rejects.toThrow("DEPLOYMENT_PLAN_EXPIRED");
  await expect(loadDeploymentPlan(join(temporaryRoot, "other-repo"), stored.id)).rejects.toThrow("DEPLOYMENT_PLAN_NOT_FOUND");

  const fresh = await saveDeploymentPlan(repo, preview);
  const stateRoot = join(process.env.LOCALAPPDATA!, "NOVA", "deployment-manager");
  const hashDir = (await readdir(stateRoot))[0]!;
  const path = join(stateRoot, hashDir, `${fresh.id}.json`);
  const edited = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  edited.SUPABASE_ACCESS_TOKEN = "unexpected credential";
  await writeFile(path, JSON.stringify(edited));
  await expect(loadDeploymentPlan(repo, fresh.id)).rejects.toThrow("DEPLOYMENT_PLAN_CORRUPT");
});
