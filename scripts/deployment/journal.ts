import { createHash, randomUUID } from "node:crypto";
import { chmod, link, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProviderName } from "./providers.ts";
import type { StoredDeploymentPlan } from "./state.ts";
import { ensureDeploymentRepositoryDirectory, loadDeploymentPlan } from "./state.ts";

const operationIdPattern = /^operation-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const identifierPattern = /^[A-Za-z0-9._:/-]{1,160}$/;
const detailCodePattern = /^[A-Z0-9_:-]{1,120}$/;
const providers = new Set<ProviderName>(["netlify", "cloudflare", "vercel", "supabase", "nova"]);
const operationStates = new Set<OperationState>([
  "draft", "ready-for-review", "approved", "executing", "candidate-verified",
  "cutover-in-progress", "verifying", "complete", "needs-manual-recovery",
  "rolling-back", "cancelled",
]);
const eventTypes = new Set<OperationEventType>([
  "operation-created", "action-planned", "request-started", "provider-confirmed",
  "provider-readback", "action-verified", "state-transition", "recovery-required",
]);
const maxEvents = 5_000;

export type OperationState =
  | "draft"
  | "ready-for-review"
  | "approved"
  | "executing"
  | "candidate-verified"
  | "cutover-in-progress"
  | "verifying"
  | "complete"
  | "needs-manual-recovery"
  | "rolling-back"
  | "cancelled";

export type OperationEventType =
  | "operation-created"
  | "action-planned"
  | "request-started"
  | "provider-confirmed"
  | "provider-readback"
  | "action-verified"
  | "state-transition"
  | "recovery-required";

export interface OperationEventInput {
  type: OperationEventType;
  actionId?: string;
  provider?: ProviderName;
  resourceId?: string;
  providerOperationId?: string;
  outcome?: "success" | "failure" | "ambiguous";
  detailCode?: string;
  nextState?: OperationState;
}

export interface OperationEvent extends OperationEventInput {
  sequence: number;
  at: string;
}

export interface DeploymentOperationJournal {
  schemaVersion: 1;
  id: string;
  repoRoot: string;
  planId: string;
  planFingerprint: string;
  sourceCommit: string;
  actionIds: string[];
  state: OperationState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  events: OperationEvent[];
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function operationPath(directory: string, id: string): string {
  return join(directory, `${id}.json`);
}

function hasOnly(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function validEvent(value: unknown, expectedSequence: number): value is OperationEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return hasOnly(event, [
    "sequence", "at", "type", "actionId", "provider", "resourceId",
    "providerOperationId", "outcome", "detailCode", "nextState",
  ]) && event.sequence === expectedSequence && typeof event.at === "string" &&
    Number.isFinite(Date.parse(event.at)) && typeof event.type === "string" &&
    eventTypes.has(event.type as OperationEventType) &&
    (event.actionId === undefined || (typeof event.actionId === "string" && actionIdPattern.test(event.actionId))) &&
    (event.provider === undefined || (typeof event.provider === "string" && providers.has(event.provider as ProviderName))) &&
    (event.resourceId === undefined || (typeof event.resourceId === "string" && identifierPattern.test(event.resourceId))) &&
    (event.providerOperationId === undefined || (typeof event.providerOperationId === "string" && identifierPattern.test(event.providerOperationId))) &&
    (event.outcome === undefined || ["success", "failure", "ambiguous"].includes(String(event.outcome))) &&
    (event.detailCode === undefined || (typeof event.detailCode === "string" && detailCodePattern.test(event.detailCode))) &&
    (event.nextState === undefined || (typeof event.nextState === "string" && operationStates.has(event.nextState as OperationState))) &&
    ((event.type === "state-transition" || event.type === "recovery-required") === (event.nextState !== undefined)) &&
    (event.type !== "recovery-required" || event.nextState === "needs-manual-recovery") &&
    (event.type !== "action-planned" || typeof event.actionId === "string") &&
    (event.type !== "request-started" || (typeof event.actionId === "string" && typeof event.provider === "string")) &&
    (!["provider-confirmed", "provider-readback", "action-verified"].includes(String(event.type)) ||
      (typeof event.actionId === "string" && typeof event.provider === "string")) &&
    (event.type !== "provider-confirmed" || event.outcome === "success") &&
    (event.type !== "provider-readback" || event.outcome !== undefined) &&
    (event.type !== "action-verified" || event.outcome === "success");
}

function validateJournal(value: unknown, repoRoot: string, expectedId: string): DeploymentOperationJournal {
  const corrupt = (): never => { throw new Error("DEPLOYMENT_OPERATION_CORRUPT: preserve the journal for recovery review"); };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return corrupt();
  const journal = value as Record<string, unknown>;
  if (!hasOnly(journal, ["schemaVersion", "id", "repoRoot", "planId", "planFingerprint", "sourceCommit", "actionIds", "state", "revision", "createdAt", "updatedAt", "events"]) ||
      journal.schemaVersion !== 1 || journal.id !== expectedId || !operationIdPattern.test(String(journal.id)) ||
      typeof journal.repoRoot !== "string" || !samePath(journal.repoRoot, repoRoot) ||
      typeof journal.planId !== "string" || !/^plan-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(journal.planId) ||
      typeof journal.planFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(journal.planFingerprint) ||
      typeof journal.sourceCommit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(journal.sourceCommit) ||
      !Array.isArray(journal.actionIds) || !journal.actionIds.every((item) => typeof item === "string" && actionIdPattern.test(item)) ||
      new Set(journal.actionIds).size !== journal.actionIds.length ||
      typeof journal.state !== "string" || !operationStates.has(journal.state as OperationState) ||
      !Number.isInteger(journal.revision) || (journal.revision as number) < 0 ||
      typeof journal.createdAt !== "string" || !Number.isFinite(Date.parse(journal.createdAt)) ||
      typeof journal.updatedAt !== "string" || !Number.isFinite(Date.parse(journal.updatedAt)) ||
      !Array.isArray(journal.events) || journal.events.length > maxEvents ||
      journal.revision !== journal.events.length ||
      !journal.events.every((event, index) => validEvent(event, index + 1))) return corrupt();
  const events = journal.events as OperationEvent[];
  if (events[0]?.type !== "operation-created" || events[0].detailCode !== "PLAN_BOUND" ||
      events.slice(1).some(({ type }) => type === "operation-created") ||
      events.some(({ actionId }) => actionId !== undefined && !(journal.actionIds as string[]).includes(actionId))) return corrupt();
  const finalTransition = [...events].reverse().find(({ nextState }) => nextState !== undefined);
  const expectedState = finalTransition?.nextState ?? "draft";
  if (journal.state !== expectedState) return corrupt();
  let replayedState: OperationState = "draft";
  for (const [index, event] of events.entries()) {
    if (!isValidEventOrder(events.slice(0, index), event)) return corrupt();
    if (event.nextState) {
      if (!transitions[replayedState].has(event.nextState)) return corrupt();
      if (event.nextState === "complete") {
        const plannedActions = events.slice(0, index).filter(({ type }) => type === "action-planned").map(({ actionId }) => actionId);
        const verifiedActions = new Set(events.slice(0, index).filter(({ type, outcome }) => type === "action-verified" && outcome === "success")
          .map(({ actionId }) => actionId));
        if (plannedActions.some((actionId) => !verifiedActions.has(actionId))) return corrupt();
      }
      replayedState = event.nextState;
    }
  }
  return value as DeploymentOperationJournal;
}

function isValidEventOrder(events: readonly OperationEvent[], next: OperationEvent): boolean {
  if (!next.actionId) return true;
  const history = events.filter(({ actionId }) => actionId === next.actionId);
  const last = history.at(-1);
  if (next.type === "action-planned") return last === undefined;
  if (next.type === "request-started") {
    return last?.type === "action-planned" || (last?.type === "provider-readback" && last.outcome === "failure");
  }
  if (next.type === "provider-confirmed") return last?.type === "request-started" && next.outcome === "success";
  if (next.type === "provider-readback") {
    return (last?.type === "request-started" || last?.type === "provider-confirmed") && next.outcome !== undefined;
  }
  if (next.type === "action-verified") return last?.type === "provider-readback" && last.outcome === "success";
  return true;
}

async function atomicWrite(directory: string, path: string, contents: string, create: boolean): Promise<void> {
  const temporary = join(directory, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (process.platform !== "win32") await chmod(temporary, 0o600);
    if (create) {
      await link(temporary, path);
      await rm(temporary, { force: true }).catch(() => undefined);
    } else {
      await rename(temporary, path);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error((error as NodeJS.ErrnoException).code === "EEXIST"
      ? "DEPLOYMENT_OPERATION_ID_COLLISION"
      : "DEPLOYMENT_OPERATION_WRITE_FAILED");
  }
}

async function withJournalWriteLock<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const path = join(directory, "journal.lock");
  const id = randomUUID();
  let acquired = false;
  try {
    const handle = await open(path, "wx", 0o600);
    acquired = true;
    try { await handle.writeFile(JSON.stringify({ id, pid: process.pid, startedAt: new Date().toISOString() })); }
    finally { await handle.close(); }
    return await run();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("DEPLOYMENT_JOURNAL_BUSY_OR_STALE_LOCK");
    }
    if (error instanceof Error && /^DEPLOYMENT_/.test(error.message)) throw error;
    throw new Error("DEPLOYMENT_JOURNAL_LOCK_FAILED");
  }
  finally {
    if (acquired) {
      try {
        const current = JSON.parse(await readFile(path, "utf8")) as { id?: unknown };
        if (current.id === id) await rm(path, { force: true });
      } catch { /* Preserve uncertain locks for manual recovery. */ }
    }
  }
}

export async function createDeploymentOperation(
  repoRoot: string,
  plan: StoredDeploymentPlan,
  now = new Date(),
): Promise<DeploymentOperationJournal> {
  if (!samePath(plan.repoRoot, repoRoot) ||
      !/^plan-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plan.id)) {
    throw new Error("DEPLOYMENT_OPERATION_PLAN_NOT_BOUND_OR_EXPIRED");
  }
  const boundPlan = await loadDeploymentPlan(repoRoot, plan.id);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(boundPlan.preview.source.commit) ||
      boundPlan.preview.source.clean !== true || boundPlan.preview.applyEnabled !== false ||
      !Array.isArray(boundPlan.preview.actions) || boundPlan.preview.actions.some(({ id }) => !actionIdPattern.test(id)) ||
      Date.parse(boundPlan.expiresAt) <= now.getTime()) {
    throw new Error("DEPLOYMENT_OPERATION_PLAN_NOT_BOUND_OR_EXPIRED");
  }
  const directory = await ensureDeploymentRepositoryDirectory(repoRoot);
  const id = `operation-${randomUUID()}`;
  const at = now.toISOString();
  const journal: DeploymentOperationJournal = {
    schemaVersion: 1,
    id,
    repoRoot: resolve(repoRoot),
    planId: boundPlan.id,
    planFingerprint: fingerprintPlan(boundPlan),
    sourceCommit: boundPlan.preview.source.commit,
    actionIds: boundPlan.preview.actions.map(({ id }) => id),
    state: "draft",
    revision: 1,
    createdAt: at,
    updatedAt: at,
    events: [{ sequence: 1, at, type: "operation-created", detailCode: "PLAN_BOUND" }],
  };
  await atomicWrite(directory, operationPath(directory, id), `${JSON.stringify(journal, null, 2)}\n`, true);
  return journal;
}

export async function loadDeploymentOperation(
  repoRoot: string,
  id: string,
): Promise<DeploymentOperationJournal> {
  if (!operationIdPattern.test(id)) throw new Error("DEPLOYMENT_OPERATION_ID_INVALID");
  const directory = await ensureDeploymentRepositoryDirectory(repoRoot);
  let raw: string;
  try { raw = await readFile(operationPath(directory, id), "utf8"); }
  catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === "ENOENT"
      ? "DEPLOYMENT_OPERATION_NOT_FOUND"
      : "DEPLOYMENT_OPERATION_READ_FAILED");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("DEPLOYMENT_OPERATION_CORRUPT: preserve the journal for recovery review"); }
  const journal = validateJournal(parsed, repoRoot, id);
  let boundPlan: StoredDeploymentPlan;
  try { boundPlan = await loadDeploymentPlan(repoRoot, journal.planId, { allowExpired: true }); }
  catch { throw new Error("DEPLOYMENT_OPERATION_PLAN_BINDING_UNAVAILABLE"); }
  if (fingerprintPlan(boundPlan) !== journal.planFingerprint || boundPlan.preview.source.commit !== journal.sourceCommit ||
      JSON.stringify(boundPlan.preview.actions.map(({ id }) => id)) !== JSON.stringify(journal.actionIds)) {
    throw new Error("DEPLOYMENT_OPERATION_PLAN_BINDING_MISMATCH");
  }
  return journal;
}

function fingerprintPlan(plan: StoredDeploymentPlan): string {
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex");
}

const transitions: Readonly<Record<OperationState, ReadonlySet<OperationState>>> = {
  draft: new Set(["ready-for-review", "cancelled"]),
  "ready-for-review": new Set(["approved", "cancelled"]),
  approved: new Set(["executing", "cancelled"]),
  executing: new Set(["candidate-verified", "needs-manual-recovery", "rolling-back"]),
  "candidate-verified": new Set(["cutover-in-progress", "needs-manual-recovery", "rolling-back"]),
  "cutover-in-progress": new Set(["verifying", "needs-manual-recovery", "rolling-back"]),
  verifying: new Set(["complete", "needs-manual-recovery", "rolling-back"]),
  "needs-manual-recovery": new Set(["rolling-back"]),
  "rolling-back": new Set(["cancelled", "needs-manual-recovery"]),
  complete: new Set(),
  cancelled: new Set(),
};

export async function appendDeploymentOperationEvent(
  repoRoot: string,
  id: string,
  expectedRevision: number,
  input: OperationEventInput,
  now = new Date(),
): Promise<DeploymentOperationJournal> {
  if (!operationIdPattern.test(id)) throw new Error("DEPLOYMENT_OPERATION_ID_INVALID");
  if (typeof input !== "object" || input === null || Array.isArray(input) ||
      !validEvent({ ...input, sequence: 1, at: now.toISOString() }, 1)) {
    throw new Error("DEPLOYMENT_OPERATION_EVENT_INVALID");
  }
  if ((input.type === "state-transition" || input.type === "recovery-required") !== (input.nextState !== undefined) ||
      (input.type === "recovery-required" && input.nextState !== "needs-manual-recovery")) {
    throw new Error("DEPLOYMENT_OPERATION_TRANSITION_REQUIRED");
  }
  const directory = await ensureDeploymentRepositoryDirectory(repoRoot);
  return await withJournalWriteLock(directory, async () => {
    const current = await loadDeploymentOperation(repoRoot, id);
    if (current.revision !== expectedRevision) throw new Error("DEPLOYMENT_OPERATION_REVISION_CONFLICT");
    const nextState = input.nextState ?? current.state;
    if (input.nextState && !transitions[current.state].has(input.nextState)) {
      throw new Error("DEPLOYMENT_OPERATION_TRANSITION_INVALID");
    }
    if (input.actionId && !current.actionIds.includes(input.actionId)) {
      throw new Error("DEPLOYMENT_OPERATION_ACTION_NOT_IN_PLAN");
    }
    if (input.type === "action-planned" && (!input.actionId || !["approved", "executing", "cutover-in-progress", "verifying", "rolling-back"].includes(current.state))) {
      throw new Error("DEPLOYMENT_OPERATION_ACTION_PLAN_STATE_INVALID");
    }
    if (input.type === "request-started" && (!input.actionId || input.provider === undefined ||
        !["executing", "cutover-in-progress", "verifying", "rolling-back"].includes(current.state))) {
      throw new Error("DEPLOYMENT_OPERATION_REQUEST_SCOPE_REQUIRED");
    }
    if (input.type === "request-started") {
      await loadDeploymentPlan(repoRoot, current.planId);
    }
    if (["provider-confirmed", "provider-readback", "action-verified"].includes(input.type) && !input.actionId) {
      throw new Error("DEPLOYMENT_OPERATION_ACTION_REQUIRED");
    }
    if (["action-planned", "provider-confirmed", "provider-readback", "action-verified"].includes(input.type) &&
        (!input.actionId || !isValidEventOrder(current.events, {
          ...input,
          sequence: current.revision + 1,
          at: now.toISOString(),
        } as OperationEvent))) {
      throw new Error("DEPLOYMENT_OPERATION_EVENT_ORDER_INVALID");
    }
    if (input.type === "recovery-required" && input.nextState !== "needs-manual-recovery") {
      throw new Error("DEPLOYMENT_OPERATION_RECOVERY_STATE_REQUIRED");
    }
    if (input.nextState === "complete") {
      const plannedActions = current.events.filter(({ type }) => type === "action-planned").map(({ actionId }) => actionId);
      const verifiedActions = new Set(current.events.filter(({ type, outcome }) => type === "action-verified" && outcome === "success")
        .map(({ actionId }) => actionId));
      if (plannedActions.some((actionId) => !verifiedActions.has(actionId))) {
        throw new Error("DEPLOYMENT_OPERATION_ACTIONS_UNVERIFIED");
      }
    }
    const at = now.toISOString();
    const journal: DeploymentOperationJournal = {
      ...current,
      state: nextState,
      revision: current.revision + 1,
      updatedAt: at,
      events: [...current.events, { ...input, sequence: current.revision + 1, at }],
    };
    if (journal.events.length > maxEvents) throw new Error("DEPLOYMENT_OPERATION_EVENT_LIMIT");
    await atomicWrite(directory, operationPath(directory, id), `${JSON.stringify(journal, null, 2)}\n`, false);
    return journal;
  });
}
