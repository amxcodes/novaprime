const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

async function loadProjector() {
  return import("./work-sessions-route.js");
}

const currentIdentity = {
  requestActorId: "person-1",
  currentActorId: "person-1",
  pageRequestCurrent: true,
};

const activeSession = {
  id: "session-1",
  assignmentId: "assignment-private",
  taskId: "task-private",
  title: "Prepare the delivery brief",
  startedAt: "2026-10-03T10:00:00.000Z",
  endedAt: null,
  state: "running",
  closureReason: null,
  durationMilliseconds: 120_000,
  durationMicroseconds: 120_123_000,
  privateField: "must not reach presentation",
};

test("unplanned session reads are not requested and do not create feature props", async () => {
  const { projectWorkSessions } = await loadProjector();
  assert.equal(projectWorkSessions({ sessions: false }, { sessions: [] }, currentIdentity), null);
  assert.equal(projectWorkSessions({}, { readError: "PERMISSION_DENIED" }, currentIdentity), null);
});

test("permission denials remain distinct from transport and service errors", async () => {
  const { projectWorkSessions } = await loadProjector();
  const denied = projectWorkSessions({ sessions: true }, { readError: "PERMISSION_DENIED" }, currentIdentity);
  assert.equal(denied.read.status, "denied");
  assert.match(denied.read.message, /permission/i);

  const prerequisite = projectWorkSessions({ sessions: true }, { readError: "PREREQUISITE_PERMISSION_REQUIRED" }, currentIdentity);
  assert.equal(prerequisite.read.status, "denied");

  const readError = projectWorkSessions({ sessions: true }, { readError: "REQUEST_FAILED" }, currentIdentity, () => {});
  assert.equal(readError.read.status, "error");
  assert.equal(typeof readError.read.onRetry, "function");
  assert.doesNotMatch(readError.read.message, /REQUEST_FAILED/);
});

test("ready projection keeps only presentation fields and timestamps the monotonic read", async () => {
  const { projectWorkSessions } = await loadProjector();
  const before = performance.now();
  const projected = projectWorkSessions({ sessions: true }, { sessions: [activeSession] }, currentIdentity);
  const after = performance.now();

  assert.equal(projected.canRead, true);
  assert.deepEqual(projected.eligibility, { canPause: true, canStop: true });
  assert.equal(projected.read.status, "ready");
  assert.ok(projected.read.readAt >= before && projected.read.readAt <= after);
  assert.deepEqual(projected.read.sessions[0], {
    id: "session-1",
    title: "Prepare the delivery brief",
    startedAt: activeSession.startedAt,
    endedAt: null,
    state: "running",
    closureReason: null,
    durationMilliseconds: 120_000,
  });
  assert.doesNotMatch(JSON.stringify(projected), /task-private|assignment-private|privateField/);
});

test("stale or unconfirmed identity clears session summaries and disables actions", async () => {
  const { projectWorkSessions } = await loadProjector();
  const retry = () => {};
  const changedActor = projectWorkSessions({ sessions: true }, { sessions: [activeSession] }, {
    requestActorId: "person-1",
    currentActorId: "person-2",
    pageRequestCurrent: true,
  }, retry);
  assert.deepEqual(changedActor.eligibility, { canPause: false, canStop: false });
  assert.equal(changedActor.canRead, true);
  assert.equal(changedActor.read.status, "error");
  assert.equal("sessions" in changedActor.read, false);
  assert.equal(changedActor.read.onRetry, retry);

  const stalePage = projectWorkSessions({ sessions: true }, { sessions: [activeSession] }, {
    ...currentIdentity,
    pageRequestCurrent: false,
  });
  assert.deepEqual(stalePage.eligibility, { canPause: false, canStop: false });
  assert.equal(stalePage.read.status, "error");
  assert.equal("sessions" in stalePage.read, false);

  const missingIdentity = projectWorkSessions({ sessions: true }, { sessions: [activeSession] });
  assert.deepEqual(missingIdentity.eligibility, { canPause: false, canStop: false });
  assert.equal(missingIdentity.read.status, "error");
  assert.equal("sessions" in missingIdentity.read, false);
});

test("malformed session projections fail closed instead of silently dropping records", async () => {
  const { projectWorkSessions } = await loadProjector();
  const invalid = projectWorkSessions({ sessions: true }, { sessions: [{ ...activeSession, endedAt: "not-a-date" }] }, currentIdentity);
  assert.equal(invalid.read.status, "error");
  assert.deepEqual(invalid.read.sessions, undefined);
});

function sessionActionHarness(overrides = {}) {
  const calls = { requests: [], recoveries: [], messages: [], refreshes: 0, contexts: [] };
  const behavior = {
    commandCurrent: true,
    recoveryResult: false,
    writeError: null,
    afterWrite: null,
    ...overrides,
  };
  const target = { isConnected: true };
  const host = {
    api: async (url, options) => {
      calls.requests.push({ url, options });
      if (behavior.writeError) throw behavior.writeError;
      behavior.afterWrite?.();
    },
    requestOptions: (method) => ({ method }),
    captureCommandContext: (source) => {
      const context = { source };
      calls.contexts.push(context);
      return context;
    },
    isCurrentCommand: () => behavior.commandCurrent,
    recoverProtectedCommandFailure: (error, context, message) => {
      calls.recoveries.push({ error, context, message });
      return behavior.recoveryResult;
    },
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    errorText: (error) => `Safe: ${error.code}`,
    setMessage: (message) => calls.messages.push(message),
    refreshWork: () => { calls.refreshes += 1; },
  };
  return {
    calls,
    behavior,
    target,
    sessionProps: {
      eligibility: { canPause: true, canStop: true },
      read: { status: "ready", sessions: [{ id: "session/1", state: "running" }] },
    },
    host,
  };
}

async function createActions(harness) {
  const { createWorkSessionActions } = await loadProjector();
  return createWorkSessionActions({ target: harness.target, sessionProps: harness.sessionProps, host: harness.host });
}

test("binds pause and stop to the existing session commands and refreshes only after success", async () => {
  const harness = sessionActionHarness();
  const actions = await createActions(harness);
  await actions.onPause("session/1");
  await actions.onStop("session/1");

  assert.deepEqual(harness.calls.requests, [
    { url: "/api/work-sessions/session%2F1/pause", options: { method: "POST" } },
    { url: "/api/work-sessions/session%2F1/stop", options: { method: "POST" } },
  ]);
  assert.deepEqual(harness.calls.messages, ["Work session paused.", "Work session stopped."]);
  assert.equal(harness.calls.refreshes, 2);
  assert.equal(harness.calls.contexts.every(({ source }) => source === harness.target), true);
});

test("does not issue commands for sessions outside the ready running projection or missing capability", async () => {
  const unknown = sessionActionHarness();
  const unknownActions = await createActions(unknown);
  await assert.rejects(unknownActions.onPause("unprojected"), /no longer available/);
  assert.equal(unknown.calls.requests.length, 0);

  const notRunning = sessionActionHarness();
  notRunning.sessionProps.read.sessions[0].state = "completed";
  await assert.rejects((await createActions(notRunning)).onStop("session/1"), /no longer available/);
  assert.equal(notRunning.calls.requests.length, 0);

  const denied = sessionActionHarness();
  denied.sessionProps.eligibility.canPause = false;
  await assert.rejects((await createActions(denied)).onPause("session/1"), /access changed/);
  assert.equal(denied.calls.requests.length, 0);
});

test("preserves command lifetime, protected recovery, and safe API error feedback", async () => {
  const stale = sessionActionHarness({ commandCurrent: false });
  await assert.rejects((await createActions(stale)).onPause("session/1"), /access changed/);
  assert.equal(stale.calls.requests.length, 0);

  const denied = sessionActionHarness({
    writeError: Object.assign(new Error("denied"), { httpStatus: 403 }),
    recoveryResult: true,
  });
  await assert.rejects((await createActions(denied)).onStop("session/1"), /Your access changed/);
  assert.equal(denied.calls.recoveries.length, 1);
  assert.equal(denied.calls.messages.length, 0);
  assert.equal(denied.calls.refreshes, 0);

  const failed = sessionActionHarness({
    writeError: Object.assign(new Error("internal"), { code: "REQUEST_FAILED" }),
  });
  await assert.rejects((await createActions(failed)).onPause("session/1"), /Safe: REQUEST_FAILED/);
  assert.equal(failed.calls.messages.length, 0);
  assert.equal(failed.calls.refreshes, 0);
});

test("suppresses success feedback if the page changes while a command is pending", async () => {
  const harness = sessionActionHarness({ afterWrite: () => { harness.behavior.commandCurrent = false; } });
  await assert.rejects((await createActions(harness)).onStop("session/1"), /page changed/);
  assert.equal(harness.calls.messages.length, 0);
  assert.equal(harness.calls.refreshes, 0);
});

test("keeps Work session command orchestration in the route adapter", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const loader = fs.readFileSync(path.join(__dirname, "work-route-features.js"), "utf8");
  assert.match(loader, /import\("\.\/work-sessions-route\.js"\)/);
  assert.match(app, /sessionsRoute\.createWorkSessionActions\(\{\s*target: workRouteRoot,\s*sessionProps,/);
  assert.match(app, /sessionsRoute\.projectWorkSessions\(/);
  assert.doesNotMatch(app, /async function runSessionCommand\(/);
});
