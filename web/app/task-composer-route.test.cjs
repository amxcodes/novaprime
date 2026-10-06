const assert = require("node:assert/strict");
const { test } = require("node:test");

async function loadProjector() {
  return import("./task-composer-route.js");
}

const workContext = {
  taskCreationTargets: [
    {
      key: "untrusted-key",
      id: "client-stream-1",
      kind: "client",
      name: "Delivery",
      clientName: "Northstar",
      billingPolicyClass: "billable",
      billingPolicyRevision: 8,
      clientId: "private-client-id",
      unrelated: "must not reach the composer",
    },
    {
      id: "organisation-stream-1",
      kind: "organisation",
      name: "Internal",
      clientName: "must not be used for an organisation target",
      billingPolicyClass: "invalid-policy",
      requiredGroupId: "group-1",
      groupName: "Research",
      billingPolicyRevision: 17,
    },
    {
      id: "client-stream-1",
      kind: "client",
      name: "Delivery",
      clientName: "Northstar",
      requiredGroupId: "group-2",
      groupName: "   ",
    },
    { id: "not-a-workstream", kind: "office", name: "Office" },
    { id: "missing-name", kind: "client" },
  ],
  clientWorkstreams: [{ id: "private-stream", name: "Not a create target" }],
  organisationWorkstreams: [{ id: "private-organisation-stream", name: "Not a create target" }],
  groups: [
    {
      id: "group-1",
      name: "Research",
      clientWorkstreamId: "client-stream-1",
      organisationWorkstreamId: null,
      canCreateTask: true,
      canViewGroup: true,
      clientId: "private-client-id",
      privateGroupMemberNames: ["Private Person"],
    },
    {
      id: "group-2",
      name: "Internal Group",
      clientWorkstreamId: null,
      organisationWorkstreamId: "organisation-stream-1",
      canCreateTask: true,
      canViewGroup: false,
      privateField: "not projected",
    },
    {
      id: "group-hidden",
      name: "Visible only",
      clientWorkstreamId: "client-stream-1",
      organisationWorkstreamId: null,
      canCreateTask: false,
    },
    {
      id: "group-ambiguous",
      name: "Invalid scope",
      clientWorkstreamId: "client-stream-1",
      organisationWorkstreamId: "organisation-stream-1",
      canCreateTask: true,
    },
  ],
  canReceiveAssignments: true,
  privateTopLevelField: "not projected",
};

test("a role without task creation gets no optional choices even if DTOs contain data", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const props = projectTaskComposerOptions({
    canCreate: false,
    workContextResult: workContext,
    catalogResult: { entries: [{ id: "secret", title: "Private" }], permissions: { view: true } },
    catalogRequested: true,
    correctionTasksResult: { tasks: [{ id: "secret-task" }] },
    correctionsRequested: true,
    departmentsResult: { departments: [{ id: "secret-dept", name: "Private" }] },
    departmentsRequested: true,
  });

  assert.deepEqual(props, {
    canCreate: false,
    targets: { status: "not-requested" },
    groups: { status: "not-requested" },
    catalog: { status: "not-requested" },
    corrections: { status: "not-requested" },
    departments: { status: "not-requested" },
    selfAssignment: {
      status: "unavailable",
      message: "Self-assignment eligibility could not be confirmed.",
    },
  });
  assert.doesNotMatch(JSON.stringify(props), /secret|Private|private/);
});

test("creation targets come only from the server creation-target list and use a strict projection", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const props = projectTaskComposerOptions({ canCreate: true, workContextResult: workContext });

  assert.equal(props.targets.status, "ready");
  assert.deepEqual(props.targets.items, [
    {
      key: "client:client-stream-1",
      id: "client-stream-1",
      kind: "client",
      name: "Delivery",
      clientName: "Northstar",
      billingPolicyClass: "billable",
    },
    {
      key: "organisation:organisation-stream-1:group:group-1",
      id: "organisation-stream-1",
      kind: "organisation",
      name: "Internal",
      billingPolicyClass: null,
      requiredGroupId: "group-1",
      groupName: "Research",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(props.targets), /clientId|billingPolicyRevision|untrusted-key|private/);
  assert.equal(props.targets.items.some((item) => item.id === "private-stream"), false);
  assert.equal(props.targets.items.some((item) => item.id === "private-organisation-stream"), false);
});

test("group choices require canCreateTask and exactly one workstream scope", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const props = projectTaskComposerOptions({ canCreate: true, workContextResult: workContext });

  assert.deepEqual(props.groups, {
    status: "ready",
    items: [
      { id: "group-1", name: "Research", workstreamId: "client-stream-1", workstreamKind: "client" },
      { id: "group-2", name: "Internal Group", workstreamId: "organisation-stream-1", workstreamKind: "organisation" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(props.groups), /canViewGroup|private|clientId|privateGroup/);
});

test("catalog entries require an endpoint view or manage grant and omit unrelated response data", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const catalogResult = {
    entries: [{
      id: "entry-1", title: "Prepare briefing", description: "Draft the brief", priority: "high", revision: 3,
      createdByName: "Private Person", updatedAt: "2026-10-03", internalNotes: "not projected",
    }],
    proposals: [{ id: "proposal-private", reason: "Private" }],
    permissions: { view: true, manage: false, review: true },
  };
  const props = projectTaskComposerOptions({ canCreate: true, catalogResult, catalogRequested: true });

  assert.deepEqual(props.catalog, {
    status: "ready",
    items: [{ id: "entry-1", title: "Prepare briefing", description: "Draft the brief", priority: "high", revision: 3 }],
  });
  assert.doesNotMatch(JSON.stringify(props.catalog), /createdByName|updatedAt|proposal-private|internalNotes/);

  const manager = projectTaskComposerOptions({
    canCreate: true,
    catalogResult: { entries: catalogResult.entries, permissions: { manage: true } },
    catalogRequested: true,
  });
  assert.equal(manager.catalog.status, "ready");

  const denied = projectTaskComposerOptions({
    canCreate: true,
    catalogResult: { entries: catalogResult.entries, permissions: { view: false, manage: false } },
    catalogRequested: true,
  });
  assert.deepEqual(denied.catalog, { status: "denied", message: "Your role cannot load task definitions." });
  assert.doesNotMatch(JSON.stringify(denied.catalog), /Prepare briefing/);
});

test("correction choices include only approved or done non-corrections with a valid workstream scope", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const correctionTasksResult = {
    tasks: [
      {
        id: "task-approved", title: "Approved brief", status: "approved", isCorrection: false,
        workstream: { id: "client-stream-1", kind: "client", clientName: "Northstar" },
        description: "private description", assignmentId: "private-assignment",
      },
      {
        id: "task-done", title: "Completed report", status: "done", isCorrection: false,
        workstream: { id: "organisation-stream-1", kind: "organisation" },
      },
      { id: "in-progress", title: "Not finished", status: "in_progress", isCorrection: false, workstream: { id: "client-stream-1", kind: "client" } },
      { id: "nested-correction", title: "Correction", status: "done", isCorrection: true, workstream: { id: "client-stream-1", kind: "client" } },
      { id: "unknown-correction-status", title: "Cannot confirm", status: "done", workstream: { id: "client-stream-1", kind: "client" } },
      { id: "missing-scope", title: "No scope", status: "approved", isCorrection: false, workstream: null },
      { id: "unknown-scope", title: "Unknown kind", status: "approved", isCorrection: false, workstream: { id: "stream-3", kind: "office" } },
    ],
    page: { total: 900 },
  };
  const props = projectTaskComposerOptions({ canCreate: true, correctionTasksResult, correctionsRequested: true });

  assert.deepEqual(props.corrections, {
    status: "ready",
    items: [
      { id: "task-approved", title: "Approved brief", workstreamId: "client-stream-1", workstreamKind: "client" },
      { id: "task-done", title: "Completed report", workstreamId: "organisation-stream-1", workstreamKind: "organisation" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(props.corrections), /private|description|assignmentId|total/);
});

test("requested departments are projected to id and name only", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const props = projectTaskComposerOptions({
    canCreate: true,
    departmentsResult: {
      departments: [
        { id: "dept-1", name: "Operations", managerPersonId: "private-person", revision: 9 },
        { id: "dept-hidden", name: "Hidden elsewhere", privateField: "not included" },
        { id: "missing-name" },
      ],
    },
    departmentsRequested: true,
  });
  assert.deepEqual(props.departments, {
    status: "ready",
    items: [
      { id: "dept-1", name: "Operations" },
      { id: "dept-hidden", name: "Hidden elsewhere" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(props.departments), /managerPersonId|privateField|revision/);
});

test("unrequested option reads remain not-requested even if result objects contain data", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const props = projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { taskCreationTargets: [], groups: [], canReceiveAssignments: false },
    catalogResult: { entries: [{ id: "entry-1", title: "Hidden" }], permissions: { manage: true } },
    catalogRequested: false,
    correctionTasksResult: { tasks: [{ id: "task-1" }] },
    correctionsRequested: false,
    departmentsResult: { departments: [{ id: "dept-1", name: "Hidden" }] },
    departmentsRequested: false,
  });
  assert.deepEqual(props.catalog, { status: "not-requested" });
  assert.deepEqual(props.corrections, { status: "not-requested" });
  assert.deepEqual(props.departments, { status: "not-requested" });
});

test("requested reads preserve permission denial, transport error, and malformed-response states", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const denied = projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { readError: "PERMISSION_DENIED" },
    catalogResult: { readError: "PREREQUISITE_PERMISSION_REQUIRED" },
    catalogRequested: true,
    correctionTasksResult: { readError: "NETWORK_ERROR" },
    correctionsRequested: true,
    departmentsResult: {},
    departmentsRequested: true,
  });
  assert.equal(denied.targets.status, "denied");
  assert.equal(denied.groups.status, "denied");
  assert.equal(denied.selfAssignment.status, "unavailable");
  assert.equal(denied.catalog.status, "denied");
  assert.equal(denied.corrections.status, "error");
  assert.equal(denied.departments.status, "error");
  assert.doesNotMatch(JSON.stringify(denied), /PERMISSION_DENIED|PREREQUISITE_PERMISSION_REQUIRED|NETWORK_ERROR/);

  const malformedContext = projectTaskComposerOptions({ canCreate: true, workContextResult: { groups: [] } });
  assert.equal(malformedContext.targets.status, "error");
  assert.equal(malformedContext.groups.status, "ready");
});

test("failed workstream options do not erase independently authorized optional choices", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const props = projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { readError: "TIMEOUT" },
    catalogResult: { entries: [], permissions: { view: true } },
    catalogRequested: true,
    correctionTasksResult: { tasks: [] },
    correctionsRequested: true,
    departmentsResult: { departments: [] },
    departmentsRequested: true,
  });
  assert.equal(props.targets.status, "error");
  assert.equal(props.groups.status, "error");
  assert.equal(props.catalog.status, "ready");
  assert.equal(props.corrections.status, "ready");
  assert.equal(props.departments.status, "ready");
});

test("self-assignment follows only an explicit server eligibility result", async () => {
  const { projectTaskComposerOptions } = await loadProjector();
  const context = { taskCreationTargets: [], groups: [] };
  assert.deepEqual(projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { ...context, canReceiveAssignments: true },
  }).selfAssignment, { status: "eligible" });
  assert.deepEqual(projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { ...context, canReceiveAssignments: false },
  }).selfAssignment, { status: "ineligible" });
  assert.equal(projectTaskComposerOptions({
    canCreate: true,
    workContextResult: context,
  }).selfAssignment.status, "unavailable");
  assert.equal(projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { ...context, readError: "PERMISSION_DENIED", canReceiveAssignments: true },
  }).selfAssignment.status, "unavailable");
});

test("shared submission resolver revalidates options and preserves the exact task-create payload", async () => {
  const { projectTaskComposerOptions, resolveTaskComposerSubmission } = await loadProjector();
  const sources = {
    workContextResult: workContext,
    catalogResult: {
      entries: [{ id: "entry-1", title: "Prepare brief", description: "Default", priority: "normal", revision: 3 }],
      permissions: { view: true, manage: false },
    },
    correctionTasksResult: {
      tasks: [{ id: "task-approved", title: "Approved brief", status: "approved", isCorrection: false,
        workstream: { id: "client-stream-1", kind: "client" } }],
    },
    departmentsResult: { departments: [{ id: "dept-1", name: "Operations" }] },
  };
  const composerOptions = projectTaskComposerOptions({
    canCreate: true,
    workContextResult: sources.workContextResult,
    catalogResult: sources.catalogResult,
    catalogRequested: true,
    correctionTasksResult: sources.correctionTasksResult,
    correctionsRequested: true,
    departmentsResult: sources.departmentsResult,
    departmentsRequested: true,
  });
  const input = {
    title: "Quarterly service analysis",
    clientWorkstreamId: "client-stream-1",
    workGroupId: "group-1",
    organisationDepartmentId: "dept-1",
    taskCatalogEntryId: "entry-1",
    taskCatalogRevision: 3,
    description: "Summarize the last quarter.",
    priority: "high",
    dueDate: "2026-10-05",
    correctionOfTaskId: "task-approved",
    correctionReason: "Correct the previous analysis.",
    assignToSelf: true,
  };

  assert.deepEqual(resolveTaskComposerSubmission(input, { ...sources, composerOptions }), {
    status: "ready",
    payload: {
      title: "Quarterly service analysis",
      clientWorkstreamId: "client-stream-1",
      workGroupId: "group-1",
      organisationDepartmentId: "dept-1",
      taskCatalogEntryId: "entry-1",
      taskCatalogRevision: 3,
      description: "Summarize the last quarter.",
      priority: "high",
      dueDate: "2026-10-05",
      correctionOfTaskId: "task-approved",
      correctionReason: "Correct the previous analysis.",
      assignToSelf: true,
    },
  });
});

test("shared submission resolver fails closed when a chosen option no longer matches either read", async () => {
  const { projectTaskComposerOptions, resolveTaskComposerSubmission } = await loadProjector();
  const sources = {
    workContextResult: workContext,
    catalogResult: {
      entries: [{ id: "entry-1", title: "Prepare brief", description: null, priority: "normal", revision: 3 }],
      permissions: { view: true },
    },
    correctionTasksResult: {
      tasks: [{ id: "task-approved", title: "Approved brief", status: "approved", isCorrection: false,
        workstream: { id: "client-stream-1", kind: "client" } }],
    },
    departmentsResult: { departments: [{ id: "dept-1", name: "Operations" }] },
  };
  const composerOptions = projectTaskComposerOptions({
    canCreate: true,
    workContextResult: sources.workContextResult,
    catalogResult: sources.catalogResult,
    catalogRequested: true,
    correctionTasksResult: sources.correctionTasksResult,
    correctionsRequested: true,
    departmentsResult: sources.departmentsResult,
    departmentsRequested: true,
  });
  const input = {
    title: "Quarterly service analysis",
    clientWorkstreamId: "client-stream-1",
    workGroupId: "group-1",
    organisationDepartmentId: "dept-1",
    taskCatalogEntryId: "entry-1",
    taskCatalogRevision: 3,
    description: "Summary",
    priority: "high",
    dueDate: null,
    correctionOfTaskId: "task-approved",
    correctionReason: "Fix the prior brief.",
    assignToSelf: true,
  };
  const resolve = (nextInput = input, nextSources = sources) => resolveTaskComposerSubmission(nextInput, {
    ...nextSources,
    composerOptions,
  });

  assert.deepEqual(resolve(null), { status: "invalid", reason: "target-unavailable" });
  assert.deepEqual(resolve({ ...input, organisationWorkstreamId: "organisation-stream-1" }), {
    status: "invalid", reason: "target-unavailable",
  });
  assert.deepEqual(resolve({ ...input, clientWorkstreamId: "missing" }), { status: "invalid", reason: "target-unavailable" });
  assert.deepEqual(resolve(input, { ...sources, workContextResult: { ...workContext, taskCreationTargets: [] } }), {
    status: "invalid", reason: "target-stale",
  });
  assert.deepEqual(resolve({ ...input, workGroupId: "group-wrong" }), { status: "invalid", reason: "group-unavailable" });
  assert.deepEqual(resolve(input, {
    ...sources,
    catalogResult: { ...sources.catalogResult, entries: [{ ...sources.catalogResult.entries[0], revision: 4 }] },
  }), { status: "invalid", reason: "catalog-unavailable" });
  assert.deepEqual(resolve(input, {
    ...sources,
    correctionTasksResult: { tasks: [{ ...sources.correctionTasksResult.tasks[0], status: "in_progress" }] },
  }), { status: "invalid", reason: "correction-unavailable" });
  assert.deepEqual(resolve(input, { ...sources, departmentsResult: { departments: [] } }), {
    status: "invalid", reason: "department-unavailable",
  });
  assert.deepEqual(resolve({ ...input, clientWorkstreamId: undefined, organisationWorkstreamId: "organisation-stream-1", workGroupId: "" }), {
    status: "invalid", reason: "group-required",
  });
});

test("shared submission resolver omits absent optional values and never broadens self-assignment", async () => {
  const { projectTaskComposerOptions, resolveTaskComposerSubmission } = await loadProjector();
  const sources = { workContextResult: workContext };
  const composerOptions = projectTaskComposerOptions({ canCreate: true, workContextResult: workContext });
  const resolved = resolveTaskComposerSubmission({
    title: "One-off",
    clientWorkstreamId: "client-stream-1",
    description: null,
    priority: "normal",
    dueDate: null,
    correctionOfTaskId: null,
    correctionReason: null,
    assignToSelf: true,
  }, { ...sources, composerOptions });

  assert.deepEqual(resolved, {
    status: "ready",
    payload: {
      title: "One-off",
      clientWorkstreamId: "client-stream-1",
      description: null,
      priority: "normal",
      dueDate: null,
      correctionOfTaskId: null,
      correctionReason: null,
      assignToSelf: true,
    },
  });

  const ineligible = projectTaskComposerOptions({
    canCreate: true,
    workContextResult: { ...workContext, canReceiveAssignments: false },
  });
  assert.equal(resolveTaskComposerSubmission({
    title: "One-off", clientWorkstreamId: "client-stream-1", description: null,
    priority: "normal", dueDate: null, correctionOfTaskId: null, correctionReason: null, assignToSelf: true,
  }, { ...sources, workContextResult: { ...workContext, canReceiveAssignments: false }, composerOptions: ineligible })
    .payload.assignToSelf, false);
  assert.equal(resolveTaskComposerSubmission({
    title: "One-off", clientWorkstreamId: "client-stream-1", description: null,
    priority: "normal", dueDate: null, correctionOfTaskId: null, correctionReason: null, assignToSelf: "false",
  }, { ...sources, composerOptions }).payload.assignToSelf, false);
});

test("shared submission resolver selects the chosen group-scoped target when one workstream has several", async () => {
  const { projectTaskComposerOptions, resolveTaskComposerSubmission } = await loadProjector();
  const workContextResult = {
    taskCreationTargets: [
      { id: "client-stream-1", kind: "client", name: "Delivery", clientName: "Northstar", requiredGroupId: "group-1", groupName: "Research" },
      { id: "client-stream-1", kind: "client", name: "Delivery", clientName: "Northstar", requiredGroupId: "group-2", groupName: "Operations" },
    ],
    groups: [
      { id: "group-1", name: "Research", clientWorkstreamId: "client-stream-1", organisationWorkstreamId: null, canCreateTask: true },
      { id: "group-2", name: "Operations", clientWorkstreamId: "client-stream-1", organisationWorkstreamId: null, canCreateTask: true },
    ],
    canReceiveAssignments: false,
  };
  const composerOptions = projectTaskComposerOptions({ canCreate: true, workContextResult });
  const resolution = resolveTaskComposerSubmission({
    title: "Prepare operations report",
    clientWorkstreamId: "client-stream-1",
    workGroupId: "group-2",
    description: null,
    priority: "normal",
    dueDate: null,
    correctionOfTaskId: null,
    correctionReason: null,
    assignToSelf: false,
  }, { composerOptions, workContextResult });

  assert.deepEqual(resolution, {
    status: "ready",
    payload: {
      title: "Prepare operations report",
      clientWorkstreamId: "client-stream-1",
      workGroupId: "group-2",
      description: null,
      priority: "normal",
      dueDate: null,
      correctionOfTaskId: null,
      correctionReason: null,
      assignToSelf: false,
    },
  });
});
