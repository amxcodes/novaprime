const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const routeModule = import("./work-collaboration-actions-route.js");

function makeHarness(overrides = {}) {
  const calls = { lookups: [], requests: [], recoveries: [], messages: [], refreshes: 0, contexts: [] };
  const behavior = {
    request: { id: "request-1", status: "pending", canAccept: true, canDecline: true, canWithdraw: true },
    commandCurrent: true,
    identityCurrent: true,
    recoveryResult: false,
    writeError: null,
    afterWrite: null,
    ...overrides,
  };
  const target = { isConnected: true };
  const host = {
    getRequestForKind: (kind, id) => {
      calls.lookups.push({ kind, id });
      return behavior.request?.id === id ? behavior.request : undefined;
    },
    api: async (url, options) => {
      calls.requests.push({ url, options });
      if (behavior.writeError) throw behavior.writeError;
      behavior.afterWrite?.();
      return {};
    },
    requestOptions: (method, body) => ({ method, body }),
    captureCommandContext: (source) => {
      const context = { source };
      calls.contexts.push(context);
      return context;
    },
    isCurrentCommand: () => behavior.commandCurrent,
    isCurrentCommandIdentity: () => behavior.identityCurrent,
    recoverProtectedCommandFailure: (error, context, message) => {
      calls.recoveries.push({ error, context, message });
      return behavior.recoveryResult;
    },
    setMessage: (message) => calls.messages.push(message),
    refreshWork: () => { calls.refreshes += 1; },
  };
  return { calls, behavior, target, host };
}

async function actionFor(harness) {
  const { createWorkCollaborationResolveAction } = await routeModule;
  return createWorkCollaborationResolveAction({ target: harness.target, host: harness.host });
}

test("resolves reviewer requests through the existing endpoint and refreshes only after confirmation", async () => {
  const harness = makeHarness();
  const onResolve = await actionFor(harness);
  await onResolve("reviewer", { id: "request-1" }, "accept");

  assert.deepEqual(harness.calls.lookups, [{ kind: "reviewer", id: "request-1" }]);
  assert.deepEqual(harness.calls.requests, [{
    url: "/api/task-reviewer-requests/request-1/accept",
    options: { method: "POST", body: {} },
  }]);
  assert.deepEqual(harness.calls.messages, ["Reviewer request accepted."]);
  assert.equal(harness.calls.refreshes, 1);
  assert.equal(harness.calls.contexts[0].source, harness.target);
});

test("resolves handover requests with the existing withdraw contract", async () => {
  const harness = makeHarness();
  const onResolve = await actionFor(harness);
  await onResolve("handover", { id: "request-1" }, "withdraw");

  assert.equal(harness.calls.requests[0].url, "/api/task-handover-requests/request-1/withdraw");
  assert.deepEqual(harness.calls.requests[0].options, { method: "POST", body: {} });
  assert.deepEqual(harness.calls.messages, ["Handover request withdrawn."]);
  assert.equal(harness.calls.refreshes, 1);
});

test("checks the server-projected pending status and decision eligibility before issuing a command", async () => {
  for (const request of [
    { id: "request-1", status: "accepted", canAccept: true },
    { id: "request-1", status: "pending", canAccept: false },
    undefined,
  ]) {
    const harness = makeHarness({ request });
    const onResolve = await actionFor(harness);
    await assert.rejects(onResolve("reviewer", { id: "request-1" }, "accept"), /no longer available/);
    assert.equal(harness.calls.requests.length, 0);
    assert.equal(harness.calls.contexts.length, 0);
    assert.equal(harness.calls.refreshes, 0);
  }
});

test("rejects unknown request kinds and decisions before looking up or calling a server endpoint", async () => {
  const harness = makeHarness();
  const onResolve = await actionFor(harness);
  await assert.rejects(onResolve("other", { id: "request-1" }, "accept"), /not supported/);
  await assert.rejects(onResolve("reviewer", { id: "request-1" }, "approve"), /not supported/);
  assert.equal(harness.calls.lookups.length, 0);
  assert.equal(harness.calls.requests.length, 0);
  assert.equal(harness.calls.contexts.length, 0);
});

test("command lifetime, session changes, and protected permission failures prevent false success", async () => {
  const staleBeforeWrite = makeHarness({ commandCurrent: false });
  const staleAction = await actionFor(staleBeforeWrite);
  await assert.rejects(staleAction("reviewer", { id: "request-1" }, "accept"), /before this action could start/);
  assert.equal(staleBeforeWrite.calls.requests.length, 0);

  const staleAfterWrite = makeHarness({ afterWrite: () => { staleAfterWrite.behavior.commandCurrent = false; } });
  const staleAfterWriteAction = await actionFor(staleAfterWrite);
  await assert.rejects(staleAfterWriteAction("reviewer", { id: "request-1" }, "accept"), /before this action completed/);
  assert.equal(staleAfterWrite.calls.messages.length, 0);
  assert.equal(staleAfterWrite.calls.refreshes, 0);

  const changedSession = makeHarness({ identityCurrent: false, writeError: new Error("denied") });
  const changedSessionAction = await actionFor(changedSession);
  await assert.rejects(changedSessionAction("reviewer", { id: "request-1" }, "accept"), /session changed/);
  assert.equal(changedSession.calls.recoveries.length, 0);

  const protectedFailure = makeHarness({
    writeError: Object.assign(new Error("PERMISSION_DENIED"), { httpStatus: 403 }),
    recoveryResult: true,
  });
  const protectedFailureAction = await actionFor(protectedFailure);
  await assert.rejects(protectedFailureAction("reviewer", { id: "request-1" }, "accept"), /collaboration access changed/);
  assert.equal(protectedFailure.calls.recoveries.length, 1);
  assert.equal(protectedFailure.calls.refreshes, 0);
  assert.equal(protectedFailure.calls.messages.length, 0);
});

test("keeps unhandled current-command failures intact and documents the narrow app host composition", async () => {
  const failure = Object.assign(new Error("REQUEST_FAILED"), { httpStatus: 500 });
  const harness = makeHarness({ writeError: failure });
  const onResolve = await actionFor(harness);
  await assert.rejects(onResolve("reviewer", { id: "request-1" }, "accept"), (error) => error === failure);
  assert.equal(harness.calls.refreshes, 0);

  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /import \{ createWorkCollaborationResolveAction \} from "\.\/app\/work-collaboration-actions-route\.js"/);
  assert.match(app, /getRequestForKind:\s*\(kind, requestId\)\s*=>/);
  assert.match(app, /onResolve:\s*onResolveCollaboration/);
});
