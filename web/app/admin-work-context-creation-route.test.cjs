const assert = require("node:assert/strict");
const { test } = require("node:test");

async function dependencies() {
  const { createAdminWorkContextCreationRoute } = await import("./admin-work-context-creation-route.js");
  const { canShowAdminFeature, hasAnyPermissionGrant, hasPermissionGrant } = await import("../admin-read-state.js");
  return { createAdminWorkContextCreationRoute, canShowAdminFeature, hasAnyPermissionGrant, hasPermissionGrant };
}

const grants = [
  { permissionKey: "clients.create", scope: "organisation" },
  { permissionKey: "clients.view", scope: "client", clientId: "client-authorized" },
  { permissionKey: "workstreams.create", scope: "client", clientId: "client-authorized" },
  { permissionKey: "groups.create", scope: "client_workstream", clientWorkstreamId: "stream-authorized" },
];
const allScopeGrants = [...grants, { permissionKey: "workstreams.create", scope: "organisation" }];

function makeData(actorGrants = { actorPersonId: "actor-1", grants }) {
  return {
    actorGrants,
    workContext: {
      clients: [
        { id: "client-authorized", name: "Northstar", privateField: "should not escape" },
        { id: "client-hidden", name: "Restricted client" },
      ],
      clientWorkstreams: [
        { id: "stream-authorized", clientId: "client-authorized", clientName: "Northstar", name: "Delivery", private: "omit" },
        { id: "stream-hidden", clientId: "client-hidden", clientName: "Restricted client", name: "Private stream" },
      ],
      organisationWorkstreams: [
        { id: "org-stream", name: "Internal" },
      ],
      groups: [{ id: "private-group", privateField: "not passed to creation projector" }],
    },
  };
}

async function createHarness(options = {}) {
  const { createAdminWorkContextCreationRoute, canShowAdminFeature, hasAnyPermissionGrant, hasPermissionGrant } = await dependencies();
  const data = options.data || makeData(options.actorGrants);
  const state = {
    adminData: data,
    actorGrants: data.actorGrants,
    identityEpoch: 8,
    identityPersonId: "actor-1",
  };
  const target = { isConnected: true };
  const lifetime = { id: "admin-work-context-life" };
  const events = [];
  const searches = [];
  const route = createAdminWorkContextCreationRoute({
    state,
    target,
    lifetime,
    identityEpoch: state.identityEpoch,
    actorPersonId: "actor-1",
    isCurrentPageRequest: (value) => value === lifetime && options.pageCurrent !== false,
    canShowAdminFeature,
    hasAdminPermission: (read, permission, permissionTarget) =>
      hasPermissionGrant(read?.actorGrants, permission, permissionTarget),
    hasAnyPermissionGrant,
    adminReadIssue: (read) => read?.readError ? { message: "Work context choices could not be loaded." } : undefined,
    searchWorkContext: options.searchWorkContext || (async (query) => {
      searches.push(query);
      return options.searchResult || data.workContext;
    }),
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    runProtectedCommand: (permission, permissionTarget, method, path, payload, successMessage) => {
      if (!permission(state.adminData)) throw Object.assign(new Error("Current work-context access changed."), { uiMessage: true });
      events.push({ method, path, payload, successMessage, permissionTarget });
      return Promise.resolve(undefined);
    },
  });
  return { data, state, target, lifetime, route, events, searches };
}

test("route projects only grant-authorized client and workstream selector options", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);
  assert.deepEqual(props.clientOptions, [{ id: "client-authorized", name: "Northstar" }]);
  assert.deepEqual(props.groupWorkstreamOptions, [{ id: "stream-authorized", name: "Delivery", kind: "client" }]);
  assert.equal(props.canCreateClient, true);
  assert.equal(props.canCreateClientWorkstream, true);
  assert.equal(props.canCreateOrganisationWorkstream, false);
  assert.equal(props.canCreateGroup, true);
  assert.doesNotMatch(JSON.stringify(props), /client-hidden|stream-hidden|privateField|private-group/);
});

test("remote selector search rechecks exact grants against server results and strips unrelated fields", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);

  const clients = await props.onSearchClients("Northstar");
  const groups = await props.onSearchGroupWorkstreams("Delivery");

  assert.deepEqual(harness.searches, ["Northstar", "Delivery"]);
  assert.deepEqual(clients, [{ value: "client-authorized", label: "Northstar" }]);
  assert.deepEqual(groups, [{ value: "client:stream-authorized", label: "Client · Delivery" }]);
  assert.doesNotMatch(JSON.stringify([...clients, ...groups]), /client-hidden|stream-hidden|privateField/);
});

test("discards remote search results when the Admin snapshot changes in flight", async () => {
  let finishSearch;
  const deferred = await createHarness({
    searchWorkContext: () => new Promise((resolve) => { finishSearch = resolve; }),
  });
  const deferredProps = deferred.route.createProps(deferred.data);
  const pending = deferredProps.onSearchClients("Northstar");
  deferred.state.adminData = { ...deferred.data };
  finishSearch(deferred.data.workContext);
  await assert.rejects(pending, /page or account changed during work-context search/);
});

test("existing client, client-workstream, organisation-workstream, and group POST contracts stay exact", async () => {
  const harness = await createHarness({ actorGrants: { actorPersonId: "actor-1", grants: allScopeGrants } });
  const props = harness.route.createProps(harness.data);
  await props.onCreateClient("Northstar Labs");
  await props.onCreateClientWorkstream({ name: "  Delivery  ", clientId: "client-authorized" });
  await props.onCreateOrganisationWorkstream("Operations");
  await props.onCreateGroup({ name: "  Platform  ", workstreamId: "stream-authorized", workstreamKind: "client" });

  assert.deepEqual(harness.events.map(({ method, path, payload, permissionTarget }) => ({ method, path, payload, permissionTarget })), [
    { method: "POST", path: "/api/clients", payload: { name: "Northstar Labs" }, permissionTarget: {} },
    { method: "POST", path: "/api/workstreams/client", payload: { name: "  Delivery  ", clientId: "client-authorized" }, permissionTarget: { clientId: "client-authorized" } },
    { method: "POST", path: "/api/workstreams/organisation", payload: { name: "Operations" }, permissionTarget: {} },
    { method: "POST", path: "/api/work-groups", payload: { name: "  Platform  ", clientWorkstreamId: "stream-authorized" }, permissionTarget: { clientWorkstreamId: "stream-authorized" } },
  ]);
});

test("current scope and group pairing are checked again before a command is issued", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);
  await assert.rejects(
    Promise.resolve().then(() => props.onCreateClientWorkstream({ name: "Private", clientId: "client-hidden" })),
    /Current work-context access changed/,
  );
  await assert.rejects(
    Promise.resolve().then(() => props.onCreateGroup({ name: "Wrong target", workstreamId: "stream-hidden", workstreamKind: "client" })),
    /Current work-context access changed/,
  );
  assert.deepEqual(harness.events, []);
});

test("stale Admin snapshots, page lifetimes, identities, and removed grants refuse writes", async () => {
  const stale = await createHarness();
  const props = stale.route.createProps(stale.data);
  stale.state.adminData = { ...stale.data };
  await assert.rejects(Promise.resolve().then(() => props.onCreateClient("Another")), /page or account changed/);
  assert.deepEqual(stale.events, []);

  const grantChanged = await createHarness();
  const grantProps = grantChanged.route.createProps(grantChanged.data);
  grantChanged.data.actorGrants = { actorPersonId: "actor-1", grants: [] };
  await assert.rejects(Promise.resolve().then(() => grantProps.onCreateClient("Another")), /access changed/);
  assert.deepEqual(grantChanged.events, []);

  const identityChanged = await createHarness();
  const identityProps = identityChanged.route.createProps(identityChanged.data);
  identityChanged.state.identityEpoch += 1;
  await assert.rejects(Promise.resolve().then(() => identityProps.onCreateClient("Another")), /page or account changed/);
  assert.deepEqual(identityChanged.events, []);
});
