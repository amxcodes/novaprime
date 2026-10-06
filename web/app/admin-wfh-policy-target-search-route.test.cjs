const assert = require("node:assert/strict");
const { test } = require("node:test");

function hasGrant(read, key) {
  return Array.isArray(read?.grants) && read.grants.some((grant) =>
    grant.permissionKey === key && grant.scope === "organisation");
}

function canViewPeople(read) {
  return Array.isArray(read?.grants) && read.grants.some((grant) =>
    grant.permissionKey === "people.view" && ["organisation", "own_record", "office", "organisation_department"].includes(grant.scope));
}

async function harness({ grants = [], result, pageCurrent = true } = {}) {
  const { createWfhPolicyTargetSearchRoute } = await import("./admin-wfh-policy-target-search-route.js");
  const events = [];
  const data = { actorGrants: { grants } };
  const state = { adminData: data };
  const target = { isConnected: true };
  const route = createWfhPolicyTargetSearchRoute({
    state,
    target,
    lifetime: "page-life",
    isCurrentPageRequest: () => pageCurrent,
    canShowAdminFeature: (read, feature) => feature === "wfhOverrides" && (
      hasGrant(read, "availability.wfh_policy.view") || hasGrant(read, "availability.wfh_policy.manage")),
    hasPermissionGrant: hasGrant,
    canViewAdminPeople: canViewPeople,
    captureCommandContext: () => ({ id: "request-context" }),
    isCurrentCommand: () => true,
    isCurrentCommandIdentity: () => true,
    errorText: (error) => error?.message || "Request failed.",
    recoverProtectedCommandFailure: (error, context) => { events.push(["recover", error?.httpStatus, context?.id]); return true; },
    pageApi: async (path, lifetime) => {
      events.push(["read", path, lifetime]);
      return result || { options: [{ id: "office-1", label: "Central" }] };
    },
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
  });
  return { data, state, target, route, events };
}

test("WFH remote options use the bounded server endpoint and expose only value and label", async () => {
  const testRoute = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ] });
  const options = await testRoute.route.searchTargets("office", "Central HQ");
  assert.deepEqual(testRoute.events, [[
    "read", "/api/availability/wfh-policy-targets?kind=office&q=Central+HQ", "page-life",
  ]]);
  assert.deepEqual(options, [{ value: "office-1", label: "Central" }]);
});

test("target family access stays independent and person search requires people.view", async () => {
  const noPeople = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ] });
  await assert.rejects(noPeople.route.searchTargets("person", "Jordan"), /access changed/);
  assert.equal(noPeople.events.length, 0);

  const scopedPeople = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "people.view", scope: "office", officeId: "office-1" },
  ] });
  assert.deepEqual(await scopedPeople.route.searchTargets("person", "Jordan"), [
    { value: "office-1", label: "Central" },
  ]);
  assert.equal(scopedPeople.events[0][1], "/api/availability/wfh-policy-targets?kind=person&q=Jordan");
  await assert.rejects(scopedPeople.route.searchTargets("office", "Central"), /access changed/);
});

test("invalid, stale, and malformed WFH target searches fail closed", async () => {
  const testRoute = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ] });
  await assert.rejects(testRoute.route.searchTargets("unknown", "x"), /invalid/);
  await assert.rejects(testRoute.route.searchTargets("office", "x".repeat(101)), /invalid/);
  assert.equal(testRoute.events.length, 0);

  const minimized = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ], result: { options: [{ id: "office-1", label: "Central", email: "private@example.test" }] } });
  assert.deepEqual(await minimized.route.searchTargets("office", "Central"), [{ value: "office-1", label: "Central" }]);

  const malformed = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ], result: { options: [{ id: "office-1" }] } });
  await assert.rejects(malformed.route.searchTargets("office", "Central"), /invalid/);

  const stale = await harness({ grants: [
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ], pageCurrent: false });
  await assert.rejects(stale.route.searchTargets("office", "Central"), /access changed/);
  assert.equal(stale.events.length, 0);
});
