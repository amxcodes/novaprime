const assert = require("node:assert/strict");
const { test } = require("node:test");

function grant(permissionKey, scope, clientId) {
  return { permissionKey, scope, ...(clientId ? { clientId } : {}) };
}

function hasPermission(data, permissionKey, target = {}) {
  return data?.actorGrants?.grants?.some((row) => row.permissionKey === permissionKey && (
    row.scope === "organisation" || (row.scope === "client" && row.clientId === target.clientId)
  )) === true;
}

function canViewPeople(read) {
  return read?.grants?.some((row) => row.permissionKey === "people.view" && row.scope === "organisation") === true;
}

async function harness({ grants = [], people = { people: [
  { id: "person-1", displayName: "  Avery Kim  ", email: "avery@example.test" },
  { id: "person-2", email: "morgan@example.test" },
] }, pageCurrent = true, identityEpoch = 3 } = {}) {
  const { createAdminClientMembershipsRoute } = await import("./admin-client-memberships-route.js");
  const events = [];
  const data = {
    actorGrants: { grants },
    workContext: { clients: [
      { id: "client-1", name: "Northstar", private: "omit" },
      { id: "client-2", name: "Juniper", private: "omit" },
    ] },
    people,
  };
  const state = { adminData: data, identityEpoch, identityPersonId: "actor-1", actorGrants: data.actorGrants };
  const target = { isConnected: true };
  const lifetime = { id: "admin-page" };
  const route = createAdminClientMembershipsRoute({
    state,
    target,
    lifetime,
    isCurrentPageRequest: (value) => value === lifetime && pageCurrent,
    isWithinApp: (value) => value === target && target.isConnected,
    hasAdminPermission: hasPermission,
    canViewAdminPeople: canViewPeople,
    captureCommandContext: (value) => ({ source: value, identityEpoch: state.identityEpoch }),
    isCurrentCommand: (context) => context.identityEpoch === state.identityEpoch && target.isConnected,
    isCurrentCommandIdentity: (context) => context.identityEpoch === state.identityEpoch,
    recoverProtectedCommandFailure: (error, context) => {
      events.push(["recover", error?.httpStatus, context?.identityEpoch]);
      return error?.recover === true;
    },
    api: async (path, options) => { events.push(["api", path, options]); return { saved: true }; },
    pageApi: async (path, value) => { events.push(["pageApi", path, value]); return { memberships: [] }; },
    requestOptions: (method, body) => ({ method, body }),
    errorText: (error) => error?.message || "Membership request failed.",
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    setMessage: (message) => events.push(["message", message]),
  });
  return { data, state, target, lifetime, route, events };
}

test("client target projection includes only safe IDs and labels covered by organization or exact-client grants", async () => {
  const scoped = await harness({ grants: [grant("clients.members.manage", "client", "client-2")] });
  assert.deepEqual(scoped.route.projectTargets(scoped.data), [{ id: "client-2", name: "Juniper" }]);
  assert.doesNotMatch(JSON.stringify(scoped.route.projectTargets(scoped.data)), /private/);

  const org = await harness({ grants: [grant("clients.members.manage", "organisation")] });
  assert.deepEqual(org.route.projectTargets(org.data), [
    { id: "client-1", name: "Northstar" },
    { id: "client-2", name: "Juniper" },
  ]);
});

test("membership props require a live exact-client grant and keep the People roster separately authorized", async () => {
  const restricted = await harness({ grants: [grant("clients.members.manage", "client", "client-1")] });
  const props = restricted.route.createProps(restricted.data, { id: "client-1", name: "untrusted label" });
  assert.deepEqual(props.client, { id: "client-1", name: "Northstar" });
  assert.equal(props.canViewMemberships, true);
  assert.equal(props.canManageMemberships, true);
  assert.equal(props.peopleOptions, null);
  assert.throws(() => restricted.route.createProps(restricted.data, "client-2"), /no longer allows membership management/);

  const independentPeople = await harness({ grants: [
    grant("clients.members.manage", "client", "client-1"),
    grant("people.view", "organisation"),
  ] });
  assert.deepEqual(independentPeople.route.createProps(independentPeople.data, "client-1").peopleOptions, [
    { id: "person-1", label: "  Avery Kim  " },
    { id: "person-2", label: "morgan@example.test" },
  ]);
});

test("expanding a target creates props without eager membership reads; feature requests retain exact paths and bodies", async () => {
  const harnessed = await harness({ grants: [grant("clients.members.manage", "organisation")] });
  const props = harnessed.route.createProps(harnessed.data, "client-1");
  assert.deepEqual(harnessed.events, []);

  await props.request({ method: "GET", path: "/api/clients/client%2Fone/members?limit=50" });
  await props.runCommand(
    () => props.request({
      method: "POST",
      path: "/api/clients/client%2Fone/members",
      body: { personId: "person-1", membershipLabel: "Delivery", effectiveOn: "2026-10-01" },
    }),
    "Client membership added.",
  );
  assert.deepEqual(harnessed.events.filter(([kind]) => ["pageApi", "api", "message"].includes(kind)), [
    ["pageApi", "/api/clients/client%2Fone/members?limit=50", harnessed.lifetime],
    ["api", "/api/clients/client%2Fone/members", {
      method: "POST", body: { personId: "person-1", membershipLabel: "Delivery", effectiveOn: "2026-10-01" },
    }],
    ["message", "Client membership added."],
  ]);
});

test("closing an individual client disclosure invalidates its in-flight host ports", async () => {
  const harnessed = await harness({ grants: [grant("clients.members.manage", "organisation")] });
  let expanded = true;
  const props = harnessed.route.createProps(harnessed.data, "client-1", () => expanded);
  expanded = false;
  assert.equal(props.isCurrent(), false);
  await assert.rejects(props.request({ method: "GET", path: "/api/clients/client-1/members?limit=50" }), /page or client membership access changed/);
  assert.deepEqual(harnessed.events, []);
});

test("snapshot, route lifetime, actor epoch, and current client grants invalidate props safely", async () => {
  const staleSnapshot = await harness({ grants: [grant("clients.members.manage", "organisation")] });
  const props = staleSnapshot.route.createProps(staleSnapshot.data, "client-1");
  staleSnapshot.state.adminData = { ...staleSnapshot.data };
  assert.equal(staleSnapshot.route.projectTargets(staleSnapshot.data).length, 0);
  assert.equal(props.isCurrent(), false);
  await assert.rejects(props.request({ method: "GET", path: "/api/clients/client-1/members?limit=50" }), /page or client membership access changed/);
  assert.deepEqual(staleSnapshot.events, []);

  const revoked = await harness({ grants: [grant("clients.members.manage", "client", "client-1")] });
  const revokedProps = revoked.route.createProps(revoked.data, "client-1");
  revoked.data.actorGrants.grants = [];
  assert.equal(revokedProps.isCurrent(), false);
  await assert.rejects(revokedProps.runCommand(async () => ({ saved: true }), "Saved."), /page or client membership access changed/);
  assert.deepEqual(revoked.events, []);

  const expired = await harness({ grants: [grant("clients.members.manage", "organisation")], pageCurrent: false });
  assert.deepEqual(expired.route.projectTargets(expired.data), []);
});
