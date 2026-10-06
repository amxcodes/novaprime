const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { projectWorkTaskDetail } = require("../src/features/work/task-detail/projection.ts");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const taskId = "00000000-0000-4000-8000-000000000002";

async function loadRoute() {
  return import("./work-task-detail-route.js");
}

function task(overrides = {}) {
  return {
    id: taskId,
    title: "Prepare the delivery brief",
    description: "Summarize the latest work.",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-10-10",
    dueDateRevision: 7,
    assignments: [{ personName: "A. Person", personId: "private-id", status: "in_progress" }],
    ...overrides,
  };
}

function createHost(overrides = {}) {
  const calls = { reads: [], writes: [], mounted: [], recovered: [] };
  const behavior = {
    pageCurrent: true,
    commandCurrent: true,
    identityCurrent: true,
    readResult: { task: task() },
    readError: null,
    writeResult: { changed: true, dueDate: "2026-10-11", dueDateRevision: 8, notifiedAssigneeCount: 1 },
    writeError: null,
    recoveryResult: false,
    ...overrides,
  };
  const host = {
    api: async (endpoint, options) => {
      calls.writes.push({ endpoint, options });
      if (behavior.writeError) throw behavior.writeError;
      return behavior.writeResult;
    },
    beginPageRequestLifetime: () => "next-lifetime",
    captureCommandContext: (source) => ({ source }),
    errorText: () => "Safe error copy.",
    getSubmittedDueDate: (form) => form.dueDate,
    isCurrentCommand: () => behavior.commandCurrent,
    isCurrentCommandIdentity: () => behavior.identityCurrent,
    isCurrentPageRequest: () => behavior.pageCurrent,
    leaveTaskDetail() {},
    mountReactIsland: (target, Component, props) => calls.mounted.push({ target, Component, props }),
    pageApi: async (endpoint, lifetime) => {
      calls.reads.push({ endpoint, lifetime });
      if (behavior.readError) throw behavior.readError;
      return behavior.readResult;
    },
    projectTaskDetail: projectWorkTaskDetail,
    recoverProtectedCommandFailure: (error, context) => {
      calls.recovered.push({ error, context });
      return behavior.recoveryResult;
    },
    requestOptions: (method, body) => ({ method, body }),
  };
  return { host: { ...host, ...overrides.host }, behavior, calls };
}

async function mountReady(overrides = {}) {
  const { createWorkTaskDetailRoute } = await loadRoute();
  const fixture = createHost(overrides);
  const Component = function TaskDetail() {};
  const route = createWorkTaskDetailRoute(fixture.host);
  await route({ taskId, board: "task-board", lifetime: "current-lifetime", Component });
  return { ...fixture, props: fixture.calls.mounted.at(-1).props, Component, route };
}

test("rejects invalid task IDs before making a read", async () => {
  const { createWorkTaskDetailRoute } = await loadRoute();
  const { host, calls } = createHost();
  await createWorkTaskDetailRoute(host)(
    { taskId: "not-a-uuid", board: "task-board", lifetime: "current-lifetime", Component: function TaskDetail() {} },
  );

  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.mounted.map(({ props }) => props.read), [
    { status: "loading" },
    { status: "unavailable", message: "This task is not available to your account.", canRetry: false },
  ]);
});

test("loads through the exact task endpoint and mounts only the safe task projection", async () => {
  const { props, calls, Component } = await mountReady({ readResult: { task: task({ privateMeta: "omit" }) } });

  assert.deepEqual(calls.reads, [{ endpoint: `/api/tasks/${taskId}`, lifetime: "current-lifetime" }]);
  assert.equal(calls.mounted.at(-1).Component, Component);
  assert.equal(props.read.status, "ready");
  assert.equal(props.read.data.title, "Prepare the delivery brief");
  assert.equal(Object.hasOwn(props.read.data, "id"), false);
  assert.equal(JSON.stringify(props).includes("private-id"), false);
  assert.equal(JSON.stringify(props).includes("privateMeta"), false);
  assert.equal(Object.hasOwn(props, "actorGrants"), false);
  assert.equal(Object.hasOwn(props, "auth"), false);
  assert.equal(typeof props.onSaveDueDate, "function");
});

test("ignores a task read that resolves after the page lifetime changes", async () => {
  const { createWorkTaskDetailRoute } = await loadRoute();
  let resolveRead;
  const fixture = createHost({
    pageApi: undefined,
  });
  fixture.host.pageApi = (endpoint, lifetime) => new Promise((resolve) => {
    fixture.calls.reads.push({ endpoint, lifetime });
    resolveRead = resolve;
  });
  const route = createWorkTaskDetailRoute(fixture.host);
  const pending = route({ taskId, board: "task-board", lifetime: "old-lifetime", Component: function TaskDetail() {} });
  fixture.behavior.pageCurrent = false;
  resolveRead({ task: task() });
  await pending;

  assert.deepEqual(fixture.calls.mounted.map(({ props }) => props.read), [{ status: "loading" }]);
});

test("aborts a due-date action after its command context goes stale", async () => {
  const { props, host, behavior, calls } = await mountReady();
  let resolveWrite;
  host.api = (endpoint, options) => {
    calls.writes.push({ endpoint, options });
    return new Promise((resolve) => { resolveWrite = resolve; });
  };
  const pending = props.onSaveDueDate({ dueDate: "2026-10-11" });
  behavior.commandCurrent = false;
  resolveWrite({ changed: true, dueDate: "2026-10-11", dueDateRevision: 8 });

  assert.deepEqual(await pending, { status: "aborted" });
  assert.deepEqual(calls.writes[0], {
    endpoint: `/api/tasks/${taskId}/due-date`,
    options: { method: "PATCH", body: {
      dueDate: "2026-10-11",
      expectedDueDate: "2026-10-10",
      expectedDueDateRevision: 7,
    } },
  });
});

test("sends the due-date revision contract and reports notification feedback", async () => {
  const { props, calls } = await mountReady();
  const result = await props.onSaveDueDate({ dueDate: "2026-10-11" });

  assert.deepEqual(calls.writes, [{
    endpoint: `/api/tasks/${taskId}/due-date`,
    options: { method: "PATCH", body: {
      dueDate: "2026-10-11",
      expectedDueDate: "2026-10-10",
      expectedDueDateRevision: 7,
    } },
  }]);
  assert.deepEqual(result, {
    status: "saved",
    dueDate: "2026-10-11",
    message: "Due date updated; 1 active assignee notified.",
  });
});

test("preserves conflict messages for stale, no-longer-editable, and missing tasks", async () => {
  const { props, behavior } = await mountReady();
  const cases = [
    ["TASK_DUE_DATE_CONFLICT", "This due date changed since the task was opened. Reload task details to see the current date, then enter your change again."],
    ["TASK_DUE_DATE_NOT_EDITABLE", "The task status changed and its due date is no longer editable. Reload task details."],
    ["TASK_NOT_FOUND", "This task is no longer available. Reload to confirm its current access."],
  ];

  for (const [code, message] of cases) {
    behavior.writeError = Object.assign(new Error(code), { code });
    assert.deepEqual(await props.onSaveDueDate({ dueDate: "2026-10-11" }), { status: "conflict", message });
  }
});

test("keeps forbidden task reads local and indistinguishable from missing tasks", async () => {
  const { createWorkTaskDetailRoute } = await loadRoute();
  const unavailable = {
    status: "unavailable",
    message: "This task is not available to your account. It may have moved or your access may have changed.",
    canRetry: false,
  };
  for (const httpStatus of [403, 404]) {
    const readFailure = Object.assign(new Error("protected"), {
      httpStatus,
      code: httpStatus === 403 ? "PERMISSION_DENIED" : "TASK_NOT_FOUND",
    });
    const fixture = createHost({ readError: readFailure });
    await createWorkTaskDetailRoute(fixture.host)(
      { taskId, board: "task-board", lifetime: "current-lifetime", Component: function TaskDetail() {} },
    );
    assert.deepEqual(fixture.calls.mounted.at(-1).props.read, unavailable);
  }
});

test("lets the host drop an expired-session task read after its identity lifetime is cleared", async () => {
  const { createWorkTaskDetailRoute } = await loadRoute();
  const fixture = createHost();
  fixture.host.pageApi = async () => {
    fixture.behavior.pageCurrent = false;
    throw Object.assign(new Error("expired"), { httpStatus: 401, code: "SESSION_EXPIRED" });
  };
  await createWorkTaskDetailRoute(fixture.host)(
    { taskId, board: "task-board", lifetime: "current-lifetime", Component: function TaskDetail() {} },
  );

  assert.deepEqual(fixture.calls.mounted.map(({ props }) => props.read), [{ status: "loading" }]);
});

test("aborts protected task writes through the host recovery boundary", async () => {
  const fixture = await mountReady();
  for (const httpStatus of [401, 403]) {
    fixture.behavior.writeError = Object.assign(new Error("protected"), { httpStatus, code: "ACCESS_CHANGED" });
    fixture.behavior.recoveryResult = true;
    assert.deepEqual(await fixture.props.onSaveDueDate({ dueDate: "2026-10-11" }), { status: "aborted" });
  }
  assert.deepEqual(fixture.calls.recovered.map(({ error }) => error.httpStatus), [401, 403]);
});

test("keeps task detail composition in its adapter while Work retains route ownership", async () => {
  const routeSource = fs.readFileSync(path.join(__dirname, "work-task-detail-route.js"), "utf8");
  assert.match(appSource, /createWorkTaskDetailRoute\(/);
  assert.match(appSource, /await workTaskDetailRoute\(\{ taskId, board: taskDetailRoot, lifetime, Component: taskDetailUi\.module\.TaskDetail \}\)/);
  assert.doesNotMatch(appSource, /async function renderTaskDetail\(/);
  assert.match(routeSource, /"\/api\/tasks\/" \+ encodeURIComponent\(taskId\)/);
  assert.match(routeSource, /expectedDueDateRevision/);
});
