const assert = require("node:assert/strict");
const { test } = require("node:test");

function grant(permissionKey, scope = "organisation") { return { permissionKey, scope }; }

async function harness({ grants = [grant("roles.view")], pageCurrent = true, options, afterSearch } = {}) {
  const { createAdminRoleScopeTargetsRoute } = await import("./admin-role-scope-targets-route.js");
  const calls = [];
  const data = { actorGrants: { grants } };
  const state = { identityEpoch: 5, adminData: data };
  const target = { isConnected: true };
  const lifetime = { page: "admin" };
  const route = createAdminRoleScopeTargetsRoute({
    state,
    target,
    lifetime,
    identityEpoch: state.identityEpoch,
    isCurrentPageRequest: (value) => value === lifetime && pageCurrent,
    hasAdminPermission: (read, permission) => read?.actorGrants?.grants?.some((row) =>
      row.permissionKey === permission && row.scope === "organisation") === true,
    pageApi: async (path, pageLifetime) => {
      calls.push([path, pageLifetime]);
      afterSearch?.(state);
      return options || { options: [
        { id: "target-1", name: "Northstar" },
        { id: "target-2", name: "Juniper" },
        { id: "target-3", name: "ignored beyond bound" },
      ] };
    },
    captureCommandContext: () => ({ identityEpoch: state.identityEpoch }),
    isCurrentCommand: (context) => context.identityEpoch === state.identityEpoch && target.isConnected,
    recoverProtectedCommandFailure: (error) => error?.recover === true,
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
  });
  return { route, calls, data, state, target, lifetime };
}

test("role target searches use the exact remote endpoint and return only safe bounded option fields", async () => {
  const current = await harness();
  assert.deepEqual(await current.route.searchTargets("client_workstream", "  North  "), [
    { value: "target-1", label: "Northstar" },
    { value: "target-2", label: "Juniper" },
    { value: "target-3", label: "ignored beyond bound" },
  ]);
  assert.deepEqual(current.calls, [[
    "/api/roles/scope-targets?scope=client_workstream&q=North",
    current.lifetime,
  ]]);
});

test("scope target search requires roles.view and rejects unsupported kinds before transport", async () => {
  const denied = await harness({ grants: [grant("roles.edit")] });
  await assert.rejects(denied.route.searchTargets("office", "central"), /role-view access/);
  assert.deepEqual(denied.calls, []);

  const unsupported = await harness();
  await assert.rejects(unsupported.route.searchTargets("person", "Avery"), /supported role scope/);
  assert.deepEqual(unsupported.calls, []);
});

test("scope target search invalidates when the Admin snapshot changes before response", async () => {
  const stale = await harness({ afterSearch: (state) => { state.adminData = { ...state.adminData }; } });
  await assert.deepEqual(await stale.route.searchTargets("client", "Northstar"), []);
  assert.equal(stale.calls.length, 1);
});

test("late target responses and malformed results fail closed", async () => {
  const late = await harness();
  const pending = late.route.searchTargets("group", "Design");
  late.state.identityEpoch += 1;
  assert.deepEqual(await pending, []);

  const malformed = await harness({ options: { options: [{ id: "valid", name: "Group" }, { id: "bad" }] } });
  assert.deepEqual(await malformed.route.searchTargets("group", "Design"), [{ value: "valid", label: "Group" }]);
});
