const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mountWorkContextRoute, projectWorkContextExplorerRead } = require("./work-context-route.js");

const client = { id: "client-1", name: "Northwind" };
const Component = function WorkContextExplorer() {};

function makeMount(overrides = {}) {
  const calls = { mounts: [], featureMessages: [], capabilityInputs: [], readIssues: [], searches: [] };
  const dependencies = {
    target: { isConnected: true },
    result: {
      clients: [client],
      clientWorkstreams: [{ id: "stream-1", client_id: "client-1", client_name: "Northwind", name: "Delivery" }],
      organisationWorkstreams: [{ id: "org-stream-1", name: "Internal" }],
      groups: [{ id: "group-1", name: "Northwind team", clientWorkstreamId: "stream-1", canViewGroup: true, canCreateTask: false }],
    },
    ui: { WorkContextExplorer: Component },
    uiLoadError: null,
    actorGrants: { permissions: ["clients.departments.manage"] },
    projectDepartmentCreation: (data, dependencies) => {
      calls.capabilityInputs.push({ data, dependencies });
      return { authorizedClientIds: ["client-1"], onCreate: async () => {} };
    },
    hasPermission: () => true,
    runCommand: async (...args) => args,
    getReadIssue: (result, resource) => {
      calls.readIssues.push([result, resource]);
      if (!result?.readError) return undefined;
      return { message: `${resource}: ${result.readError}` };
    },
    mountIsland: (target, component, props) => calls.mounts.push({ target, component, props }),
    searchWorkContext: async (query) => {
      calls.searches.push(query);
      return {
        clients: [client],
        clientWorkstreams: [{ id: "stream-1", client_id: "client-1", client_name: "Northwind", name: "Delivery" }],
        organisationWorkstreams: [], taskCreationTargets: [], groups: [],
      };
    },
    showFeatureMessage: (...args) => calls.featureMessages.push(args),
    ...overrides,
  };
  return { calls, dependencies };
}

test("projects the authorized Work Context response into the explorer's bounded view contract", () => {
  const result = projectWorkContextExplorerRead({
    clients: [client],
    clientWorkstreams: [{ id: "stream-1", client_id: "client-1", client_name: "Northwind", name: "Delivery", internal: "drop" }],
    organisationWorkstreams: [{ id: "org-stream-1", name: "Internal", internal: "drop" }],
    taskCreationTargets: [
      { key: "client:create-stream", id: "create-stream", name: "Implementation", kind: "client", clientName: "Northwind", billingPolicyClass: "billable", billingPolicyRevision: 4 },
      { key: "organisation:create-stream", id: "org-create-stream", name: "Planning", kind: "organisation", billingPolicyClass: "non_billable", billingPolicyRevision: 1 },
      { key: "client:hidden-group", id: "group-stream", name: "Delivery", kind: "client", clientName: "Northwind", requiredGroupId: "group-2", groupName: "Private team" },
      { key: "client:already-visible", id: "stream-1", name: "Delivery", kind: "client", clientName: "Northwind" },
    ],
    groups: [{ id: "group-1", name: "Team", clientWorkstreamId: "stream-1", organisationWorkstreamId: null, canViewGroup: 1, canCreateTask: true }],
  });

  assert.deepEqual(result, {
    status: "ready",
    projection: {
      clients: [{ id: "client-1", name: "Northwind" }],
      clientWorkstreams: [{ id: "stream-1", clientId: "client-1", clientName: "Northwind", name: "Delivery" }],
      organisationWorkstreams: [{ id: "org-stream-1", name: "Internal" }],
      workstreamTaskTargets: [
        { id: "create-stream", name: "Implementation", kind: "client", clientName: "Northwind" },
        { id: "org-create-stream", name: "Planning", kind: "organisation" },
      ],
      groups: [{ id: "group-1", name: "Team", clientWorkstreamId: "stream-1", organisationWorkstreamId: null, canViewGroup: false, canCreateTask: true }],
    },
  });
});

test("projects only unique create-only workstream targets absent from the browsable hierarchy", () => {
  const result = projectWorkContextExplorerRead({
    clients: [client],
    clientWorkstreams: [{ id: "stream-visible", client_id: "client-1", client_name: "Northwind", name: "Visible" }],
    organisationWorkstreams: [{ id: "org-visible", name: "Visible internal" }],
    taskCreationTargets: [
      { key: "client:private-1", id: "client-private", name: "Private delivery", kind: "client", clientName: "Northwind", billingPolicyClass: "billable", billingPolicyRevision: 3 },
      { key: "client:private-duplicate", id: "client-private", name: "Duplicate label", kind: "client", clientName: "Other", billingPolicyClass: "billable", billingPolicyRevision: 1 },
      { key: "organisation:private", id: "org-private", name: "Internal pilot", kind: "organisation", billingPolicyClass: "non_billable", billingPolicyRevision: 1 },
      { key: "client:group-only", id: "client-private", name: "Private delivery", kind: "client", clientName: "Northwind", requiredGroupId: "group-1", groupName: "Team" },
      { key: "client:visible", id: "stream-visible", name: "Visible", kind: "client", clientName: "Northwind" },
      { key: "organisation:visible", id: "org-visible", name: "Visible internal", kind: "organisation" },
      { key: "invalid", id: 22, name: "Malformed", kind: "client" },
      { key: "empty", id: "", name: " ", kind: "organisation" },
    ],
    groups: [],
  });

  assert.deepEqual(result.projection.workstreamTaskTargets, [
    { id: "client-private", name: "Private delivery", kind: "client", clientName: "Northwind" },
    { id: "org-private", name: "Internal pilot", kind: "organisation" },
  ]);
  assert.equal(JSON.stringify(result.projection).includes("billingPolicyClass"), false);
  assert.equal(JSON.stringify(result.projection).includes("requiredGroupId"), false);
});

test("mounts ready Work Context with only the projected department capability", () => {
  const { calls, dependencies } = makeMount();
  const result = mountWorkContextRoute(dependencies);

  assert.equal(result.status, "mounted");
  assert.equal(calls.mounts.length, 1);
  assert.equal(calls.mounts[0].target, dependencies.target);
  assert.equal(calls.mounts[0].component, Component);
  assert.equal(calls.mounts[0].props.readState.status, "ready");
  assert.deepEqual(calls.mounts[0].props.departmentCreation.authorizedClientIds, ["client-1"]);
  assert.equal(calls.capabilityInputs[0].data.actorGrants, dependencies.actorGrants);
  assert.equal(calls.capabilityInputs[0].data.workContext, dependencies.result);
  assert.equal(calls.capabilityInputs[0].dependencies.hasPermission(
    { actorGrants: dependencies.actorGrants }, "clients.departments.manage", { clientId: "client-1" },
  ), true);
  assert.deepEqual(calls.readIssues, [[dependencies.result, "work context"]]);
});

test("routes explorer searches through the host's authenticated server read", async () => {
  const { calls, dependencies } = makeMount();
  mountWorkContextRoute(dependencies);

  const result = await calls.mounts[0].props.onSearch("Delivery");

  assert.deepEqual(calls.searches, ["Delivery"]);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.projection.clientWorkstreams.map(({ name }) => name), ["Delivery"]);
  assert.deepEqual(result.projection.organisationWorkstreams, []);
});

test("permission-denied and prerequisite-denied reads mount denied presentation without department actions", () => {
  for (const readError of ["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]) {
    const { calls, dependencies } = makeMount({
      result: { readError, clients: [client] },
      projectDepartmentCreation: (data) => ({
        authorizedClientIds: data.workContext.readError ? [] : ["client-1"],
        onCreate: async () => {},
      }),
    });

    const route = mountWorkContextRoute(dependencies);
    assert.equal(route.readState.status, "denied");
    assert.equal(calls.mounts[0].props.readState.status, "denied");
    assert.equal(calls.mounts[0].props.readState.message, `work context: ${readError}`);
    assert.equal(calls.mounts[0].props.departmentCreation, undefined);
  }
});

test("request failures mount an error presentation and do not expose department actions", () => {
  const { calls, dependencies } = makeMount({
    result: { readError: "REQUEST_FAILED", clients: [client] },
    projectDepartmentCreation: (data) => ({
      authorizedClientIds: data.workContext.readError ? [] : ["client-1"],
      onCreate: async () => {},
    }),
  });

  const route = mountWorkContextRoute(dependencies);
  assert.equal(route.readState.status, "error");
  assert.equal(calls.mounts[0].props.readState.status, "error");
  assert.equal(calls.mounts[0].props.readState.message, "work context: REQUEST_FAILED");
  assert.equal(calls.mounts[0].props.departmentCreation, undefined);
});

test("missing or failed feature UI stays local to the Work Context slot", () => {
  const { calls, dependencies } = makeMount({ ui: null, uiLoadError: new Error("chunk missing") });

  const result = mountWorkContextRoute(dependencies);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(calls.mounts, []);
  assert.deepEqual(calls.featureMessages, [[
    dependencies.target,
    "Work context is unavailable",
    "The work context view could not load. Refresh the page to try again.",
  ]]);
});
