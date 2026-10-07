import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeploymentPreview } from "./plan.ts";
import type { LocalDeploymentInventory } from "./inventory.ts";
import {
  appendDeploymentOperationEvent,
  createDeploymentOperation,
  loadDeploymentOperation,
} from "./journal.ts";
import { saveDeploymentPlan } from "./state.ts";

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
  database: { configured: true, providerHint: "supabase", projectRef: "abcdefghijklmnopqrst" },
  schedulerHint: "supabase",
  secretPresence: {},
  providerCredentialPresence: {},
};

async function makeOperation() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "nova-deployment-operation-"));
  setStateHome(join(temporaryRoot, "state"));
  const repo = join(temporaryRoot, "repo");
  const preview = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  });
  const plan = await saveDeploymentPlan(repo, preview);
  const operation = await createDeploymentOperation(repo, plan);
  return { repo, plan, operation };
}

test("operation journal binds its plan and source, records write-ahead events, and advances by revision", async () => {
  const { repo, operation } = await makeOperation();
  expect(operation.state).toBe("draft");
  expect(operation.planId).toMatch(/^plan-/);
  expect(operation.sourceCommit).toBe("a".repeat(40));
  expect(operation.actionIds).toContain("deploy-candidate");

  const ready = await appendDeploymentOperationEvent(repo, operation.id, 1, {
    type: "state-transition", nextState: "ready-for-review",
  });
  const approved = await appendDeploymentOperationEvent(repo, operation.id, ready.revision, {
    type: "state-transition", nextState: "approved",
  });
  const executing = await appendDeploymentOperationEvent(repo, operation.id, approved.revision, {
    type: "state-transition", nextState: "executing",
  });
  const planned = await appendDeploymentOperationEvent(repo, operation.id, executing.revision, {
    type: "action-planned", actionId: "deploy-candidate", provider: "cloudflare", resourceId: "account/worker",
    detailCode: "CANDIDATE_DEPLOY",
  });
  const started = await appendDeploymentOperationEvent(repo, operation.id, planned.revision, {
    type: "request-started", actionId: "deploy-candidate", provider: "cloudflare", resourceId: "account/worker",
  });
  const accepted = await appendDeploymentOperationEvent(repo, operation.id, started.revision, {
    type: "provider-confirmed", actionId: "deploy-candidate", provider: "cloudflare",
    providerOperationId: "deployment-123", outcome: "success",
  });
  const readback = await appendDeploymentOperationEvent(repo, operation.id, accepted.revision, {
    type: "provider-readback", actionId: "deploy-candidate", provider: "cloudflare",
    providerOperationId: "deployment-123", outcome: "success",
  });
  const verified = await appendDeploymentOperationEvent(repo, operation.id, readback.revision, {
    type: "action-verified", actionId: "deploy-candidate", provider: "cloudflare", outcome: "success",
  });
  const candidate = await appendDeploymentOperationEvent(repo, operation.id, verified.revision, {
    type: "state-transition", nextState: "candidate-verified",
  });
  const cutover = await appendDeploymentOperationEvent(repo, operation.id, candidate.revision, {
    type: "state-transition", nextState: "cutover-in-progress",
  });
  const verifying = await appendDeploymentOperationEvent(repo, operation.id, cutover.revision, {
    type: "state-transition", nextState: "verifying",
  });
  const complete = await appendDeploymentOperationEvent(repo, operation.id, verifying.revision, {
    type: "state-transition", nextState: "complete",
  });
  expect(complete.revision).toBe(13);
  expect(complete.events.at(-1)).toMatchObject({ type: "state-transition", nextState: "complete", sequence: 13 });
  expect(await loadDeploymentOperation(repo, operation.id)).toEqual(complete);
  expect(JSON.stringify(complete)).not.toMatch(/token|password|secret-value/i);
});

test("operation journal rejects stale revisions, out-of-order writes, and actions outside the bound plan", async () => {
  const { repo, operation } = await makeOperation();
  await expect(appendDeploymentOperationEvent(repo, operation.id, 0, {
    type: "state-transition", nextState: "ready-for-review",
  })).rejects.toThrow("DEPLOYMENT_OPERATION_REVISION_CONFLICT");
  await expect(appendDeploymentOperationEvent(repo, operation.id, 1, {
    type: "request-started", actionId: "deploy-candidate", provider: "cloudflare",
  })).rejects.toThrow("DEPLOYMENT_OPERATION_REQUEST_SCOPE_REQUIRED");
  await expect(appendDeploymentOperationEvent(repo, operation.id, 1, {
    type: "state-transition", nextState: "executing",
  })).rejects.toThrow("DEPLOYMENT_OPERATION_TRANSITION_INVALID");
  await expect(appendDeploymentOperationEvent(repo, operation.id, 1, {
    type: "action-planned", actionId: "delete-database", provider: "supabase",
  })).rejects.toThrow("DEPLOYMENT_OPERATION_ACTION_NOT_IN_PLAN");
});

test("concurrent journal writers cannot overwrite each other's revision", async () => {
  const { repo, operation } = await makeOperation();
  const writes = await Promise.allSettled([
    appendDeploymentOperationEvent(repo, operation.id, 1, {
      type: "state-transition", nextState: "ready-for-review",
    }),
    appendDeploymentOperationEvent(repo, operation.id, 1, {
      type: "state-transition", nextState: "ready-for-review",
    }),
  ]);
  expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(writes.filter(({ status }) => status === "rejected")).toHaveLength(1);
  expect(await loadDeploymentOperation(repo, operation.id)).toMatchObject({ revision: 2, state: "ready-for-review" });
});

test("a leftover writer lock blocks journal updates instead of risking a lost event", async () => {
  const { repo, operation } = await makeOperation();
  const root = stateRoot();
  const [hashDirectory] = await readdir(root);
  await writeFile(join(root, hashDirectory!, "journal.lock"), "stale writer marker");
  await expect(appendDeploymentOperationEvent(repo, operation.id, 1, {
    type: "state-transition", nextState: "ready-for-review",
  })).rejects.toThrow("DEPLOYMENT_JOURNAL_BUSY_OR_STALE_LOCK");
  expect(await loadDeploymentOperation(repo, operation.id)).toMatchObject({ revision: 1, state: "draft" });
});

test("journal readback rejects unknown fields and does not accept secrets as journal data", async () => {
  const { repo, operation } = await makeOperation();
  const root = stateRoot();
  const [hashDirectory] = await readdir(root);
  const path = join(root, hashDirectory!, `${operation.id}.json`);
  const edited = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  edited.SUPABASE_ACCESS_TOKEN = "must-not-be-persisted";
  await writeFile(path, JSON.stringify(edited));
  await expect(loadDeploymentOperation(repo, operation.id)).rejects.toThrow("DEPLOYMENT_OPERATION_CORRUPT");
});

test("operation journal is bound to the saved plan contents", async () => {
  const { repo, plan, operation } = await makeOperation();
  const root = stateRoot();
  const [hashDirectory] = await readdir(root);
  const path = join(root, hashDirectory!, `${plan.id}.json`);
  const edited = JSON.parse(await readFile(path, "utf8")) as { preview: { request: { runtime: string } } };
  edited.preview.request.runtime = "netlify";
  await writeFile(path, JSON.stringify(edited));
  await expect(loadDeploymentOperation(repo, operation.id)).rejects.toThrow("DEPLOYMENT_OPERATION_PLAN_BINDING_MISMATCH");
});
