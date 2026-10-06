const assert = require("node:assert/strict");
const { test } = require("node:test");

async function loadRoute() {
  return import("./work-setup-route.js");
}

function harness(routeModule, overrides = {}) {
  const roots = new Map([
    ["#work-setup-catalog-root", { isConnected: true, appended: [] }],
    ["#work-setup-billing-root", { isConnected: true, appended: [] }],
  ]);
  for (const root of roots.values()) root.append = function (child) { this.appended.push(child); };
  const loading = { removed: false, remove() { this.removed = true; } };
  const content = {
    isConnected: true,
    replaced: [],
    querySelector(selector) {
      if (selector === "[data-work-setup-loading], [data-work-setup-no-features]") return loading;
      return roots.get(selector) || null;
    },
    replaceChildren(...children) { this.replaced = children; },
  };
  const mounts = [];
  const loads = { catalog: 0, billing: 0 };
  const route = routeModule.createWorkSetupRoute({
    isCurrentPageRequest: () => true,
    mountReactIsland: (root, component, props) => mounts.push({ root, component, props }),
    noticeElement: (message, kind) => ({ message, kind }),
    loadCatalogSection: overrides.loadCatalogSection || (async () => {
      loads.catalog += 1;
      return { TaskCatalogSection: "task-catalog-component" };
    }),
    loadBillingPolicySection: overrides.loadBillingPolicySection || (async () => {
      loads.billing += 1;
      return { BillingPolicySection: "billing-policy-component" };
    }),
    readIssue: (result, resource) => {
      if (!result?.readError) return undefined;
      return { message: `${result.readError}: ${resource}` };
    },
  });
  return { route, content, loading, roots, mounts, loads };
}

const catalogData = {
  entries: [],
  proposals: [],
  permissions: { view: true, propose: false, manage: false, review: false },
};
const workContext = { clientWorkstreams: [] };
const grants = { view: true, propose: false, manage: false, review: false };

test("mounts only the task-catalog feature for a catalog-only role", async () => {
  const routeModule = await loadRoute();
  const state = harness(routeModule);
  const create = async () => "saved";
  await state.route({
    content: state.content,
    lifetime: {},
    readPlan: { taskCatalog: true, billingPolicy: false, hasAny: true },
    taskCatalog: catalogData,
    workContext,
    permissions: grants,
    onRetry() {},
    createCatalogActions: () => ({ onCreate: create }),
    createBillingActions: () => ({}),
  });

  assert.equal(state.loads.catalog, 1);
  assert.equal(state.loads.billing, 0);
  assert.equal(state.mounts.length, 1);
  assert.equal(state.mounts[0].component, "task-catalog-component");
  assert.equal(state.mounts[0].props.onCreate, create);
  assert.equal(state.mounts[0].props.read.status, "ready");
  assert.equal(state.loading.removed, true);
});

test("mounts only billing policy for a billing-only role and reports independent catalog access as missing", async () => {
  const routeModule = await loadRoute();
  const state = harness(routeModule);
  await state.route({
    content: state.content,
    lifetime: {},
    readPlan: { taskCatalog: false, billingPolicy: true, hasAny: true },
    taskCatalog: { entries: [], proposals: [], permissions: {} },
    workContext: { clientWorkstreams: [{ id: "ws-1", name: "Delivery", clientName: "Acme", canManageBillingPolicy: true }] },
    permissions: { view: false, propose: false, manage: false, review: false },
    onRetry() {},
    createCatalogActions: () => ({}),
    createBillingActions: () => ({ onLoadRules: async () => ({}) }),
  });

  assert.equal(state.loads.catalog, 0);
  assert.equal(state.loads.billing, 1);
  assert.equal(state.mounts.length, 1);
  assert.equal(state.mounts[0].component, "billing-policy-component");
  assert.equal(state.mounts[0].props.catalogAccess, "missing");
  assert.deepEqual(state.mounts[0].props.workstreams, {
    status: "ready",
    data: [{ id: "ws-1", name: "Delivery", clientName: "Acme", policyClass: null, policyRevision: 0 }],
  });
});

test("keeps denied and malformed catalog responses in safe read states", async () => {
  const { projectTaskCatalog } = await loadRoute();
  const readPlan = { taskCatalog: true };
  const permissions = { view: true, propose: false, manage: false, review: false };
  const readIssue = (result) => result?.readError ? { message: "read denied" } : undefined;

  const denied = projectTaskCatalog({ readError: "PERMISSION_DENIED" }, readPlan, permissions, readIssue);
  assert.equal(denied.snapshot.status, "denied");
  assert.equal(denied.snapshot.message, "read denied");

  const malformedEntry = projectTaskCatalog({ entries: [null], proposals: [] }, readPlan, permissions, readIssue);
  assert.equal(malformedEntry.snapshot.status, "error");
  assert.match(malformedEntry.snapshot.message, /task definitions response could not be read/);

  const malformedProposal = projectTaskCatalog({ entries: [], proposals: [{ id: "proposal-1" }] }, readPlan, permissions, readIssue);
  assert.equal(malformedProposal.snapshot.status, "error");
  assert.match(malformedProposal.snapshot.message, /task-definition proposals response could not be read/);

  const empty = projectTaskCatalog({ entries: [], proposals: [] }, readPlan, permissions, readIssue);
  assert.deepEqual(empty.snapshot, { status: "ready", data: { entries: [], proposals: [] } });

  const projected = projectTaskCatalog({ entries: [{
    id: "entry-1", title: "Prepare handoff", description: null, priority: "normal", revision: 8,
    createdByName: "Aman",
  }], proposals: [{
    id: "proposal-1", action: "update", title: "Prepare handoff", description: null,
    priority: "high", expectedRevision: 8, reason: "Clarify the review step.", status: "pending",
    proposerName: "Aman", canReview: true, reviewNote: null,
  }] }, readPlan, { ...permissions, review: false }, readIssue);
  assert.equal(projected.snapshot.data.entries[0].revision, 8);
  assert.equal(projected.snapshot.data.proposals[0].expectedRevision, 8);
  assert.equal(projected.snapshot.data.proposals[0].reason, "Clarify the review step.");
  assert.equal(projected.snapshot.data.proposals[0].canReview, false);
});

test("renders malformed workstream rows as a safe section error and preserves empty lists", async () => {
  const routeModule = await loadRoute();
  const malformed = harness(routeModule);
  await malformed.route({
    content: malformed.content,
    lifetime: {},
    readPlan: { taskCatalog: false, billingPolicy: true, hasAny: true },
    taskCatalog: { entries: [], proposals: [], permissions: {} },
    workContext: { clientWorkstreams: [null] },
    permissions: { view: false, propose: false, manage: false, review: false },
    onRetry() {},
    createCatalogActions: () => ({}),
    createBillingActions: () => ({}),
  });
  assert.equal(malformed.mounts[0].props.workstreams.status, "error");

  const empty = harness(routeModule);
  await empty.route({
    content: empty.content,
    lifetime: {},
    readPlan: { taskCatalog: false, billingPolicy: true, hasAny: true },
    taskCatalog: { entries: [], proposals: [], permissions: {} },
    workContext: { clientWorkstreams: [] },
    permissions: { view: false, propose: false, manage: false, review: false },
    onRetry() {},
    createCatalogActions: () => ({}),
    createBillingActions: () => ({}),
  });
  assert.deepEqual(empty.mounts[0].props.workstreams, { status: "ready", data: [] });
});

test("shows a section-local import fallback while mounting an independently available feature", async () => {
  const routeModule = await loadRoute();
  const state = harness(routeModule, {
    loadCatalogSection: async () => { throw new Error("catalog chunk unavailable"); },
  });
  await state.route({
    content: state.content,
    lifetime: {},
    readPlan: { taskCatalog: true, billingPolicy: true, hasAny: true },
    taskCatalog: catalogData,
    workContext,
    permissions: grants,
    onRetry() {},
    createCatalogActions: () => ({}),
    createBillingActions: () => ({}),
  });

  assert.equal(state.roots.get("#work-setup-catalog-root").appended[0].kind, "error");
  assert.match(state.roots.get("#work-setup-catalog-root").appended[0].message, /Task catalog could not load/);
  assert.equal(state.mounts.length, 1);
  assert.equal(state.mounts[0].component, "billing-policy-component");
});
