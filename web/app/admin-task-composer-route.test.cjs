const assert = require("node:assert/strict");
const { test } = require("node:test");

async function loadDependencies() {
  const { createAdminTaskComposerRoute } = await import("./admin-task-composer-route.js");
  const { canShowAdminFeature, hasAnyPermissionGrant, planAdminReads } = await import("../admin-read-state.js");
  const { projectTaskComposerOptions } = await import("./task-composer-route.js");
  return { createAdminTaskComposerRoute, canShowAdminFeature, hasAnyPermissionGrant, planAdminReads, projectTaskComposerOptions };
}

const taskGrants = [
  { permissionKey: "tasks.create", scope: "organisation" },
  { permissionKey: "tasks.view", scope: "organisation" },
  { permissionKey: "tasks.catalog.view", scope: "organisation" },
  { permissionKey: "organisation.settings.manage", scope: "organisation" },
];

function makeData(actorGrants = { actorPersonId: "actor-1", grants: taskGrants }) {
  return {
    actorGrants,
    workContext: {
      taskCreationTargets: [
        { id: "stream-client", kind: "client", name: "Delivery", clientName: "Northstar", billingPolicyClass: "billable", billingPolicyRevision: 7, clientId: "private-client-id" },
        { id: "stream-organisation", kind: "organisation", name: "Internal", requiredGroupId: "group-required", groupName: "Research", privateTarget: "omit" },
      ],
      groups: [
        { id: "group-client", name: "Client team", clientWorkstreamId: "stream-client", organisationWorkstreamId: null, canCreateTask: true, clientId: "private-client-id", privateMemberNames: ["Private Person"] },
        { id: "group-required", name: "Research", clientWorkstreamId: null, organisationWorkstreamId: "stream-organisation", canCreateTask: true, privateField: "omit" },
        { id: "group-wrong", name: "Wrong workstream", clientWorkstreamId: "stream-other", organisationWorkstreamId: null, canCreateTask: true },
        { id: "group-ambiguous", name: "Invalid", clientWorkstreamId: "stream-client", organisationWorkstreamId: "stream-organisation", canCreateTask: true },
      ],
      canReceiveAssignments: true,
      privateTopLevelField: "omit",
    },
    taskCatalog: {
      entries: [{ id: "entry-1", title: "Prepare brief", description: "Standard briefing", priority: "normal", revision: 4, internalNotes: "omit" }],
      permissions: { view: true, manage: false },
      proposals: [{ id: "private-proposal" }],
    },
    tasks: {
      tasks: [{ id: "task-correction-source", title: "Approved analysis", status: "approved", isCorrection: false,
        workstream: { id: "stream-client", kind: "client", clientName: "Northstar" }, privateAssignmentId: "omit" }],
    },
    departments: { departments: [{ id: "dept-1", name: "Operations", privateManagerPersonId: "omit" }] },
  };
}

async function createHarness(options = {}) {
  const { createAdminTaskComposerRoute, canShowAdminFeature, hasAnyPermissionGrant, planAdminReads, projectTaskComposerOptions } = await loadDependencies();
  const data = options.data || makeData(options.actorGrants);
  const state = {
    adminData: data,
    actorGrants: data.actorGrants,
    identityEpoch: 9,
    identityPersonId: "actor-1",
    taskCreateFingerprint: "",
    taskCreateRequestKey: "",
  };
  const target = { isConnected: true };
  const lifetime = { id: "admin-task-composer-life" };
  let pageIsCurrent = options.pageCurrent !== false;
  const events = [];
  const route = createAdminTaskComposerRoute({
    state,
    target,
    lifetime,
    identityEpoch: state.identityEpoch,
    actorPersonId: "actor-1",
    isCurrentPageRequest: (value) => value === lifetime && pageIsCurrent,
    canShowAdminFeature,
    hasAnyPermissionGrant,
    planAdminReads,
    projectTaskComposerOptions,
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    runProtectedCommand: (permission, permissionTarget, method, path, payload, successMessage, afterSuccess, requestHeaders) => {
      events.push({ kind: "attempt", permissionTarget, method, path, payload, successMessage, requestHeaders });
      options.beforePermissionCheck?.();
      if (!permission(state.adminData)) {
        return Promise.reject(Object.assign(new Error("Current task-creation access changed."), { uiMessage: true }));
      }
      const result = {
        assignmentId: "assignment-1",
        billingClass: "billable",
        billingPolicySource: "client_workstream",
        billingPolicyRevision: 2,
      };
      events.push({ kind: "post", method, path, payload, successMessage, requestHeaders });
      afterSuccess?.(result);
      return Promise.resolve(result);
    },
    taskCreateIdempotencyHeaders: (payload) => {
      events.push({ kind: "headers", payload });
      return { "idempotency-key": "request-key-1" };
    },
    clearTaskCreateIdempotency: (payload) => events.push({ kind: "clear", payload }),
    setMessage: (message) => events.push({ kind: "message", message }),
    taskBillingConfirmation: (task) => `Billing ${task.billingClass} · ${task.billingPolicySource} · r${task.billingPolicyRevision}`,
    taskCorrectionConfirmation: (isCorrection) => isCorrection ? " Correction preserved." : "",
  });
  return { data, state, target, lifetime, route, events, setPageCurrent(value) { pageIsCurrent = value; } };
}

function validInput(overrides = {}) {
  return {
    title: "Quarterly service analysis",
    clientWorkstreamId: "stream-client",
    workGroupId: "group-client",
    organisationDepartmentId: "dept-1",
    taskCatalogEntryId: "entry-1",
    taskCatalogRevision: 4,
    description: "Summarize the last quarter.",
    priority: "high",
    dueDate: "2026-10-05",
    correctionOfTaskId: "task-correction-source",
    correctionReason: "Correct the previous analysis.",
    assignToSelf: true,
    ...overrides,
  };
}

test("TaskComposer props expose only authorized, allowlisted choices", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);
  assert.equal(props.canCreate, true);
  assert.equal(props.selfAssignmentDefault, false);
  assert.deepEqual(props.targets.items.map(({ id, kind }) => ({ id, kind })), [
    { id: "stream-client", kind: "client" },
    { id: "stream-organisation", kind: "organisation" },
  ]);
  assert.deepEqual(props.groups.items, [
    { id: "group-client", name: "Client team", workstreamId: "stream-client", workstreamKind: "client" },
    { id: "group-required", name: "Research", workstreamId: "stream-organisation", workstreamKind: "organisation" },
    { id: "group-wrong", name: "Wrong workstream", workstreamId: "stream-other", workstreamKind: "client" },
  ]);
  assert.deepEqual(props.catalog.items, [{
    id: "entry-1", title: "Prepare brief", description: "Standard briefing", priority: "normal", revision: 4,
  }]);
  assert.deepEqual(props.corrections.items, [{
    id: "task-correction-source", title: "Approved analysis", workstreamId: "stream-client", workstreamKind: "client",
  }]);
  assert.deepEqual(props.departments.items, [{ id: "dept-1", name: "Operations" }]);
  assert.doesNotMatch(JSON.stringify(props), /private|billingPolicyRevision|privateAssignmentId|privateManagerPersonId|proposals/);
});

test("task creation keeps the exact POST payload, idempotency header, and success feedback", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);
  const payload = {
    title: "Quarterly service analysis",
    clientWorkstreamId: "stream-client",
    workGroupId: "group-client",
    organisationDepartmentId: "dept-1",
    taskCatalogEntryId: "entry-1",
    taskCatalogRevision: 4,
    description: "Summarize the last quarter.",
    priority: "high",
    dueDate: "2026-10-05",
    correctionOfTaskId: "task-correction-source",
    correctionReason: "Correct the previous analysis.",
    assignToSelf: true,
  };
  await props.onSubmit(validInput());

  assert.deepEqual(harness.events.find(({ kind }) => kind === "post"), {
    kind: "post",
    method: "POST",
    path: "/api/tasks",
    payload,
    successMessage: "Task created.",
    requestHeaders: { "idempotency-key": "request-key-1" },
  });
  assert.deepEqual(harness.events.find(({ kind }) => kind === "headers"), { kind: "headers", payload });
  assert.deepEqual(harness.events.find(({ kind }) => kind === "clear"), { kind: "clear", payload });
  assert.deepEqual(harness.events.find(({ kind }) => kind === "message"), {
    kind: "message",
    message: "Task created and added to your assignments. · Billing billable · client_workstream · r2 Correction preserved.",
  });
});

test("group choices cannot cross-pair client and organisation targets", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);
  await assert.rejects(Promise.resolve().then(() => props.onSubmit(validInput({ workGroupId: "group-required" }))), /Choose a group that is available/);
  await assert.rejects(Promise.resolve().then(() => props.onSubmit(validInput({
    clientWorkstreamId: undefined,
    organisationWorkstreamId: "stream-organisation",
    workGroupId: "",
  }))), /Choose the group required/);
  await assert.rejects(Promise.resolve().then(() => props.onSubmit(validInput({
    clientWorkstreamId: undefined,
    organisationWorkstreamId: "stream-organisation",
    workGroupId: "group-client",
  }))), /Choose the group required/);
  assert.equal(harness.events.some(({ kind }) => kind === "post"), false);
});

test("stale targets, catalog revisions, corrections, departments, and grants stop before POST", async () => {
  const changedTarget = await createHarness();
  const targetProps = changedTarget.route.createProps(changedTarget.data);
  changedTarget.data.workContext.taskCreationTargets = [];
  await assert.rejects(Promise.resolve().then(() => targetProps.onSubmit(validInput())), /workstream that is still available/);

  const changedRevision = await createHarness();
  const revisionProps = changedRevision.route.createProps(changedRevision.data);
  changedRevision.data.taskCatalog.entries[0].revision = 5;
  await assert.rejects(Promise.resolve().then(() => revisionProps.onSubmit(validInput())), /task definition is no longer available/);

  const changedCorrection = await createHarness();
  const correctionProps = changedCorrection.route.createProps(changedCorrection.data);
  changedCorrection.data.tasks.tasks[0].status = "in_progress";
  await assert.rejects(Promise.resolve().then(() => correctionProps.onSubmit(validInput())), /completed task in the selected workstream/);

  const changedDepartment = await createHarness();
  const departmentProps = changedDepartment.route.createProps(changedDepartment.data);
  changedDepartment.data.departments.departments = [];
  await assert.rejects(Promise.resolve().then(() => departmentProps.onSubmit(validInput())), /department that is still available/);

  const grantChanged = await createHarness();
  const grantProps = grantChanged.route.createProps(grantChanged.data);
  grantChanged.data.actorGrants.grants = grantChanged.data.actorGrants.grants.filter((grant) => grant.permissionKey !== "tasks.create");
  await assert.rejects(Promise.resolve().then(() => grantProps.onSubmit(validInput())), /current access no longer allows task creation/);

  for (const harness of [changedTarget, changedRevision, changedCorrection, changedDepartment, grantChanged]) {
    assert.equal(harness.events.some(({ kind }) => kind === "post"), false);
  }
});

test("snapshot and page or identity changes reject the submit callback", async () => {
  const stale = await createHarness();
  const staleProps = stale.route.createProps(stale.data);
  stale.state.adminData = { ...stale.data };
  await assert.rejects(Promise.resolve().then(() => staleProps.onSubmit(validInput())), /Admin page changed/);
  assert.equal(stale.events.length, 0);

  const identity = await createHarness();
  const identityProps = identity.route.createProps(identity.data);
  identity.state.identityEpoch += 1;
  await assert.rejects(Promise.resolve().then(() => identityProps.onSubmit(validInput())), /Admin page changed/);
  assert.equal(identity.events.length, 0);

  const page = await createHarness();
  const pageProps = page.route.createProps(page.data);
  page.setPageCurrent(false);
  await assert.rejects(Promise.resolve().then(() => pageProps.onSubmit(validInput())), /Admin page changed/);
  assert.equal(page.events.length, 0);
});

test("grants changing between validation and protected dispatch are rejected by the live predicate", async () => {
  const harness = await createHarness({
    beforePermissionCheck: () => {
      harness.data.actorGrants.grants = harness.data.actorGrants.grants.filter((grant) => grant.permissionKey !== "tasks.create");
    },
  });
  const props = harness.route.createProps(harness.data);
  await assert.rejects(props.onSubmit(validInput()), /Current task-creation access changed/);
  assert.equal(harness.events.some(({ kind }) => kind === "post"), false);
});
