const assert = require("node:assert/strict");
const { test } = require("node:test");

const ids = {
  clientTask: "00000000-0000-4000-8000-000000000001",
  workstream: "00000000-0000-4000-8000-000000000002",
  group: "00000000-0000-4000-8000-000000000003",
  assignment: "00000000-0000-4000-8000-000000000004",
  assignee: "00000000-0000-4000-8000-000000000005",
  reviewer: "00000000-0000-4000-8000-000000000006",
};

function grant(permissionKey, scope = "client", clientId = "client-1") {
  return { permissionKey, scope, ...(scope === "client" ? { clientId } : {}) };
}

function hasPermission(data, permissionKey, target = {}) {
  return data?.actorGrants?.grants?.some((row) => row.permissionKey === permissionKey && (
    row.scope === "organisation" ||
    (row.scope === "client" && row.clientId === target.clientId) ||
    (row.scope === "client_workstream" && row.clientWorkstreamId === target.clientWorkstreamId) ||
    (row.scope === "group" && row.groupId === target.groupId)
  )) === true;
}

function task(overrides = {}) {
  return {
    id: ids.clientTask,
    title: "Prepare launch files",
    status: "in_progress",
    priority: "normal",
    client: { id: "client-1", name: "Northstar" },
    workstream: { id: ids.workstream, kind: "client", name: "Delivery" },
    group: { id: ids.group, name: "Launch" },
    dueDate: "2026-10-10",
    dueDateRevision: 4,
    canAssign: true,
    canCancel: true,
    canEditDueDate: true,
    assignments: [{
      id: ids.assignment,
      personId: "00000000-0000-4000-8000-000000000007",
      personName: "Current assignee",
      reviewerPersonId: null,
      reviewerName: null,
      reviewRequired: true,
      status: "active",
      canReassign: true,
    }],
    ...overrides,
  };
}

async function harness({ grants = [], tasks = [task()], optionsResult, searchOptionsResult, pageCurrent = true } = {}) {
  const { createAdminWorkOperationsRoute } = await import("./admin-work-operations-route.js");
  const events = [];
  const data = { actorGrants: { actorPersonId: "actor-1", grants }, tasks: { tasks } };
  const state = { adminData: data, identityEpoch: 9, identityPersonId: "actor-1", actorGrants: data.actorGrants };
  const target = { isConnected: true };
  const lifetime = { id: "admin-page" };
  const route = createAdminWorkOperationsRoute({
    state,
    target,
    lifetime,
    isCurrentPageRequest: (value) => value === lifetime && pageCurrent,
    hasAdminPermission: hasPermission,
    pageApi: async (path, pageLifetime) => {
      events.push(["read", path, pageLifetime]);
      return (path.includes("?q=") ? searchOptionsResult : optionsResult) || {
        assignees: [{ id: ids.assignee, name: "  Avery Kim  " }],
        reviewers: [{ id: ids.reviewer, name: "Morgan Lee" }],
      };
    },
    runAdminProtectedCommand: async (...args) => {
      const [, , permission, , method, path, body, successMessage, afterSuccess] = args;
      if (!(typeof permission === "function" ? permission(state.adminData) : true)) {
        throw Object.assign(new Error("Your current access no longer allows this action."), { uiMessage: true });
      }
      events.push(["command", method, path, body, successMessage, afterSuccess]);
      return { changed: true, notifiedAssigneeCount: 1 };
    },
    requestOptions: (method, body) => ({ method, body }),
    errorText: (error) => error?.message || "Request failed.",
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    setMessage: (message) => events.push(["message", message]),
  });
  return { data, state, target, lifetime, route, events };
}

test("task permission target keeps the exact client, workstream, and group scope context", async () => {
  const { adminWorkOperationsPermissionTarget } = await import("./admin-work-operations-route.js");
  assert.deepEqual(adminWorkOperationsPermissionTarget(task()), {
    taskId: ids.clientTask,
    clientId: "client-1",
    clientWorkstreamId: ids.workstream,
    groupId: ids.group,
  });
  const scoped = await harness({ grants: [grant("tasks.assign", "client", "another-client")] });
  assert.equal(scoped.route.createProps(scoped.data).taskRead.items[0].canAssign, false);
  const exact = await harness({ grants: [grant("tasks.assign")] });
  assert.equal(exact.route.createProps(exact.data).taskRead.items[0].canAssign, true);
});

test("assignment options are task-scoped, bounded to safe choices, cached, and refreshed on demand", async () => {
  const harnessed = await harness({ grants: [grant("tasks.assign")] });
  const props = harnessed.route.createProps(harnessed.data);
  const first = await props.loadAssignmentOptions(ids.clientTask);
  const cached = await props.loadAssignmentOptions(ids.clientTask);
  assert.equal(first, cached);
  assert.deepEqual(first, {
    assignees: [{ id: ids.assignee, name: "Avery Kim" }],
    reviewers: [{ id: ids.reviewer, name: "Morgan Lee" }],
  });
  await props.loadAssignmentOptions(ids.clientTask, { refresh: true });
  assert.deepEqual(harnessed.events.filter(([kind]) => kind === "read"), [
    ["read", `/api/tasks/${ids.clientTask}/assignment-options`, harnessed.lifetime],
    ["read", `/api/tasks/${ids.clientTask}/assignment-options`, harnessed.lifetime],
  ]);
});

test("remote assignment searches query the scoped endpoint and retain searched IDs for write validation", async () => {
  const remoteAssignee = "00000000-0000-4000-8000-000000000008";
  const remoteReviewer = "00000000-0000-4000-8000-000000000009";
  const harnessed = await harness({
    grants: [grant("tasks.assign")],
    searchOptionsResult: {
      assignees: [{ id: remoteAssignee, name: "Zoe Remote" }],
      reviewers: [{ id: remoteReviewer, name: "Mina Remote" }],
    },
  });
  const props = harnessed.route.createProps(harnessed.data);
  await props.loadAssignmentOptions(ids.clientTask);
  const searched = await props.loadAssignmentOptions(ids.clientTask, { query: "  Remote person  " });
  assert.deepEqual(searched, {
    assignees: [{ id: remoteAssignee, name: "Zoe Remote" }],
    reviewers: [{ id: remoteReviewer, name: "Mina Remote" }],
  });
  assert.equal(harnessed.events.some(([kind, path]) => kind === "read" &&
    path === `/api/tasks/${ids.clientTask}/assignment-options?q=Remote%20person`), true);

  await props.onAssign(ids.clientTask, {
    personId: remoteAssignee,
    reviewerPersonId: remoteReviewer,
    reviewRequired: true,
  });
  assert.equal(harnessed.events.some(([kind, method, path, body]) => kind === "command" &&
    method === "POST" && path === `/api/tasks/${ids.clientTask}/assignments` &&
    body.personId === remoteAssignee && body.reviewerPersonId === remoteReviewer), true);
});

test("assignment validates server choices and sends the exact scoped request body", async () => {
  const harnessed = await harness({ grants: [grant("tasks.assign")] });
  const props = harnessed.route.createProps(harnessed.data);
  await props.onAssign(ids.clientTask, {
    personId: ids.assignee,
    reviewerPersonId: ids.reviewer,
    reviewRequired: true,
  });
  assert.deepEqual(harnessed.events.filter(([kind]) => kind === "command").map(([, method, path, body]) => [method, path, body]), [[
    "POST",
    `/api/tasks/${ids.clientTask}/assignments`,
    { personId: ids.assignee, reviewerPersonId: ids.reviewer, reviewRequired: true },
  ]]);
});

test("command gates stop stale snapshots, removed grants, ineligible task states, and unreviewed client work", async () => {
  const stale = await harness({ grants: [grant("tasks.assign")] });
  const staleProps = stale.route.createProps(stale.data);
  stale.state.adminData = { ...stale.data };
  await assert.rejects(staleProps.loadAssignmentOptions(ids.clientTask), /page or account changed/);
  assert.equal(stale.events.length, 0);

  const revoked = await harness({ grants: [grant("tasks.assign")] });
  const revokedProps = revoked.route.createProps(revoked.data);
  revoked.data.actorGrants.grants = [];
  await assert.rejects(revokedProps.loadAssignmentOptions(ids.clientTask), /does not allow assignment choices/);
  assert.throws(() => revokedProps.onAssign(ids.clientTask, {
    personId: ids.assignee, reviewerPersonId: ids.reviewer, reviewRequired: true,
  }), /no longer allows assignment/);
  assert.equal(revoked.events.some(([kind]) => kind === "command"), false);

  const cancelled = await harness({ grants: [grant("tasks.edit")], tasks: [task({ status: "cancelled" })] });
  assert.throws(() => cancelled.route.createProps(cancelled.data).onCancel(ids.clientTask), /can no longer be cancelled/);
  assert.equal(cancelled.events.some(([kind]) => kind === "command"), false);

  const clientNoReview = await harness({ grants: [grant("tasks.assign")] });
  await assert.rejects(clientNoReview.route.createProps(clientNoReview.data).onAssign(ids.clientTask, {
    personId: ids.assignee, reviewerPersonId: null, reviewRequired: false,
  }), /Client work requires review/);
  assert.equal(clientNoReview.events.some(([kind]) => kind === "read" || kind === "command"), false);
});

test("reassign, cancel, and due-date commands preserve exact routes, payloads, and revision gates", async () => {
  const harnessed = await harness({ grants: [grant("tasks.reassign"), grant("tasks.edit")] });
  const props = harnessed.route.createProps(harnessed.data);
  await props.onReassign(ids.clientTask, ids.assignment, {
    personId: ids.assignee, reviewerPersonId: ids.reviewer, reviewRequired: true,
  });
  await props.onCancel(ids.clientTask);
  await props.onUpdateDueDate(ids.clientTask, {
    dueDate: "2026-10-12", expectedDueDate: "2026-10-10", expectedDueDateRevision: 4,
  });
  assert.deepEqual(harnessed.events.filter(([kind]) => kind === "command").map(([, method, path, body]) => [method, path, body]), [
    ["POST", `/api/task-assignments/${ids.assignment}/reassign`, {
      personId: ids.assignee, reviewerPersonId: ids.reviewer, reviewRequired: true,
    }],
    ["POST", `/api/tasks/${ids.clientTask}/cancel`, undefined],
    ["PATCH", `/api/tasks/${ids.clientTask}/due-date`, {
      dueDate: "2026-10-12", expectedDueDate: "2026-10-10", expectedDueDateRevision: 4,
    }],
  ]);
  assert.throws(() => props.onUpdateDueDate(ids.clientTask, {
    dueDate: "2026-10-13", expectedDueDate: "2026-10-10", expectedDueDateRevision: 3,
  }), /revision changed/);
});
