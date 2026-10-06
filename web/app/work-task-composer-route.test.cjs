const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const routeSource = fs.readFileSync(path.join(__dirname, "work-task-composer-route.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

async function loadRoute() {
  return import("./work-task-composer-route.js");
}

function harness(overrides = {}) {
  const calls = { mounts: [], messages: [], api: [], commands: [], permissionChecks: 0 };
  const target = { isConnected: true };
  const lifetime = { page: 3 };
  const component = function TaskComposer() {};
  const workContextResult = {
    taskCreationTargets: [{ id: "stream-1", kind: "client", name: "Delivery", clientName: "Northstar" }],
    groups: [],
    canReceiveAssignments: true,
  };
  const services = {
    feature: { TaskComposer: component },
    lifetime,
    canCreateTask: () => {
      calls.permissionChecks += 1;
      return true;
    },
    workContextResult,
    catalogResult: { entries: [], permissions: { view: true } },
    catalogRequested: true,
    correctionTasksResult: { tasks: [] },
    correctionsRequested: true,
    isCurrentPageRequest: (value) => value === lifetime,
    runCommand: async (source, commandLifetime, work, resource) => {
      calls.commands.push([source, commandLifetime, resource]);
      return work();
    },
    api: async (url, request) => {
      calls.api.push([url, request]);
      return { billingClass: "billable", billingPolicySource: "workstream", billingPolicyRevision: 4 };
    },
    requestOptions: (method, body, headers) => ({ method, body: JSON.stringify(body), headers }),
    idempotencyHeaders: () => ({ "idempotency-key": "work-create-1" }),
    clearIdempotency: () => {},
    pageChangedError: () => new Error("page changed"),
    permissionDeniedError: () => new Error("permission denied"),
    billingConfirmation: () => "NOVA applied workstream billing.",
    correctionConfirmation: () => "",
    setMessage: (message) => calls.messages.push(message),
    refreshWork: () => calls.messages.push("refresh"),
    ...overrides.services,
  };
  const host = {
    mountReactIsland: (...args) => calls.mounts.push(args),
    showFeatureMessage: (...args) => calls.messages.push(args),
    ...overrides.host,
  };
  return { calls, component, host, lifetime, services, target, workContextResult };
}

test("projects current Work reads and mounts the existing TaskComposer contract", async () => {
  const { mountWorkTaskComposerRoute } = await loadRoute();
  const state = harness();

  assert.deepEqual(mountWorkTaskComposerRoute(state.target, state.services, state.host), { mounted: true });
  assert.equal(state.calls.mounts.length, 1);
  const [target, component, props] = state.calls.mounts[0];
  assert.equal(target, state.target);
  assert.equal(component, state.component);
  assert.equal(props.canCreate, true);
  assert.deepEqual(props.targets, {
    status: "ready",
    items: [{ key: "client:stream-1", id: "stream-1", kind: "client", name: "Delivery", clientName: "Northstar", billingPolicyClass: null }],
  });
  assert.deepEqual(props.catalog, { status: "ready", items: [] });
  assert.deepEqual(props.corrections, { status: "ready", items: [] });
  assert.deepEqual(props.selfAssignment, { status: "eligible" });
  assert.equal(props.heading, "Create work");
  assert.equal(props.selfAssignmentDefault, true);
  assert.equal(state.calls.permissionChecks, 1);
  assert.equal(typeof props.onSubmit, "function");
});

test("keeps optional reads explicitly not-requested and scopes import failure to the Work section", async () => {
  const { mountWorkTaskComposerRoute } = await loadRoute();
  const state = harness({ services: { catalogRequested: false, correctionsRequested: false } });
  mountWorkTaskComposerRoute(state.target, state.services, state.host);
  const props = state.calls.mounts[0][2];
  assert.deepEqual(props.catalog, { status: "not-requested" });
  assert.deepEqual(props.corrections, { status: "not-requested" });

  const failed = harness({ services: { feature: null, loadError: new Error("chunk failed") } });
  assert.deepEqual(mountWorkTaskComposerRoute(failed.target, failed.services, failed.host), { mounted: false });
  assert.deepEqual(failed.calls.messages, [[
    failed.target,
    "Task creation is unavailable",
    "Task creation could not load. Refresh Work to try again.",
  ]]);
  assert.equal(failed.calls.mounts.length, 0);
});

test("rechecks the live create capability before using projected options or calling the API", async () => {
  const { mountWorkTaskComposerRoute } = await loadRoute();
  let checks = 0;
  const state = harness({ services: {
    canCreateTask: () => ++checks === 1,
  } });
  mountWorkTaskComposerRoute(state.target, state.services, state.host);
  const props = state.calls.mounts[0][2];
  assert.equal(props.canCreate, true);

  await assert.rejects(props.onSubmit({ title: "Work item" }), /permission denied/);
  assert.equal(checks, 2);
  assert.equal(state.calls.api.length, 0);
  assert.equal(state.calls.commands.length, 0);
});

test("submits through the existing host action and exact task-create endpoint", async () => {
  const { mountWorkTaskComposerRoute } = await loadRoute();
  const state = harness();
  mountWorkTaskComposerRoute(state.target, state.services, state.host);
  const props = state.calls.mounts[0][2];
  const input = {
    title: "Prepare briefing",
    clientWorkstreamId: "stream-1",
    description: null,
    priority: "normal",
    dueDate: null,
    correctionOfTaskId: null,
    correctionReason: null,
    assignToSelf: true,
  };

  await props.onSubmit(input);

  assert.deepEqual(state.calls.api, [["/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      assignToSelf: true,
    }),
    headers: { "idempotency-key": "work-create-1" },
  }]]);
  assert.deepEqual(state.calls.commands, [[state.target, state.lifetime, "Work"]]);
  assert.deepEqual(state.calls.messages, ["Task created without assigning it to you. · NOVA applied workstream billing.", "refresh"]);
});

test("keeps authority and transport injected by the host", () => {
  assert.doesNotMatch(routeSource, /\bfetch\s*\(|hasAnyPermissionGrant|actorGrants|planWorkReads|pageApi\s*\(/);
  assert.match(appSource, /mountWorkTaskComposerRoute\(composerRoot,\s*\{[\s\S]*?canCreateTask: \(\) => hasAnyPermissionGrant\(state\.actorGrants/);
  assert.match(appSource, /mountWorkTaskComposerRoute\(composerRoot,[\s\S]*?isCurrentPageRequest,[\s\S]*?runCommand: runWorkSetupCommand,[\s\S]*?api,[\s\S]*?idempotencyHeaders: taskCreateIdempotencyHeaders/);
  assert.doesNotMatch(appSource, /const composerOptions = projectTaskComposerOptions\([\s\S]*?mountReactIsland\(composerRoot, taskComposerUi\.TaskComposer/);
});
