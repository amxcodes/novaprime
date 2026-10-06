const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const adminPageRouteSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "admin-wfh-policy-overrides-route.js"), "utf8");
const sectionsSource = fs.readFileSync(path.join(__dirname, "../src/pages/admin/admin-page-sections.ts"), "utf8");

test("Admin imports and composes WFH Overrides as its own grant-filtered typed feature", () => {
  assert.match(adminPageRouteSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "wfhOverrides"\), \(\) => import\("\.\.\/src\/features\/admin\/WfhPolicyOverridesSection\.tsx"\)\)/);
  assert.match(adminPageRouteSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "wfhOverrides"\), \(\) => import\("\.\/admin-wfh-policy-overrides-route\.js"\)\)/);
  assert.match(adminPageRouteSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "wfhOverrides"\), \(\) => import\("\.\/admin-wfh-policy-target-search-route\.js"\)\)/);
  assert.match(adminPageRouteSource, /createWfhPolicyTargetSearchRoute\(\{[\s\S]{0,360}pageApi,[\s\S]{0,180}captureCommandContext/);
  assert.match(adminPageRouteSource, /searchTargets: wfhPolicyTargetSearchRoute\?\.searchTargets/);
  assert.match(adminPageRouteSource, /state\.adminData !== data\) return;/);
  assert.match(adminPageRouteSource, /canShowAdminFeature\(\s*state\.adminData\?\.actorGrants,\s*"wfhOverrides",\s*\) \? wfhPolicyOverridesModule\?\.WfhPolicyOverridesSection/);
  assert.match(adminPageRouteSource, /"wfh-overrides": WfhPolicyOverridesSection && wfhPolicyOverridesRoute\s*\?\s*createElement\(WfhPolicyOverridesSection, wfhPolicyOverridesRoute\.createProps\(data\)\)\s*:\s*createElement\(WfhPolicyOverridesLoadFailureSection\)/);
  assert.doesNotMatch(adminPageRouteSource, /currentWfhOverrideTargetRows|createAdminWfhPolicyOverride|renderWfhOverridesSection|renderWfhOverridesEditor|mountReactIsland\(target, WfhPolicyOverrides/);
  assert.match(sectionsSource, /\["wfh-overrides", canShowAdminFeature\(read, "wfhOverrides"\)\]/);
});

test("WFH target selectors preserve their separate server-supported prerequisites", () => {
  assert.match(routeSource, /const canView = hasPermissionGrant\(currentGrantRead, "availability\.wfh_policy\.view"\)/);
  assert.match(routeSource, /const canManage = hasPermissionGrant\(currentGrantRead, "availability\.wfh_policy\.manage"\)/);
  assert.match(routeSource, /office:[\s\S]*?authorized: hasPermissionGrant\(currentGrantRead, "organisation\.settings\.manage"\)/);
  assert.match(routeSource, /organisation_department:[\s\S]*?authorized: hasPermissionGrant\(currentGrantRead, "organisation\.settings\.manage"\)/);
  assert.match(routeSource, /person:[\s\S]*?authorized: canViewAdminPeople\(currentGrantRead\)/);
  assert.doesNotMatch(routeSource, /hasAnyPermissionGrant\([^)]*people\.view/);
});

test("create keeps the guarded POST and leaves target membership validation to the server", () => {
  const helper = routeSource;
  assert.match(helper, /currentData !== data/);
  assert.match(helper, /isCurrentPageRequest\(lifetime\)/);
  assert.match(helper, /captureCommandContext\(target\)/);
  assert.match(helper, /isCurrentCommand\(context\)/);
  assert.match(helper, /hasPermissionGrant\(currentData\.actorGrants, "availability\.wfh_policy\.manage"\)/);
  assert.match(helper, /canViewAdminPeople\(currentData\.actorGrants\)/);
  assert.match(helper, /api\("\/api\/availability\/wfh-policies", requestOptions\("POST", input\)\)/);
  assert.match(helper, /pageApi\("\/api\/availability\/wfh-policies", lifetime\)/);
  assert.match(helper, /hasPermissionGrant\(state\.adminData\?\.actorGrants, "availability\.wfh_policy\.view"\)/);
  assert.match(helper, /latest state is unverified; reload Admin to verify it[\s\S]*?recoverProtectedCommandFailure\(error, context\)/);
});

async function createAdapterHarness(grants, overrides = {}) {
  const { createWfhPolicyOverridesRoute } = await import("./admin-wfh-policy-overrides-route.js");
  const events = [];
  const data = {
    actorGrants: { grants },
    wfhPolicies: { policies: [{ id: "policy-1", targetType: "person", targetId: "person-1" }] },
    offices: { offices: [{ id: "office-1", name: "Central" }] },
    departments: { departments: [{ id: "department-1", name: "People" }] },
    people: { people: [{ id: "person-1", displayName: "Jordan Lee", email: "jordan@example.test" }] },
  };
  const state = { adminData: data, pendingAdminCommandFocus: false };
  const target = { isConnected: true };
  const grant = (read, key) => Array.isArray(read?.grants) && read.grants.some((row) =>
    row.permissionKey === key && row.scope === "organisation");
  const route = createWfhPolicyOverridesRoute({
    state,
    target,
    lifetime: "page-life",
    isCurrentPageRequest: () => true,
    canShowAdminFeature: (read, feature) => feature === "wfhOverrides" && (
      grant(read, "availability.wfh_policy.view") || grant(read, "availability.wfh_policy.manage")),
    hasPermissionGrant: grant,
    canViewAdminPeople: (read) => grant(read, "people.view"),
    captureCommandContext: () => ({ id: "command" }),
    isCurrentCommand: () => true,
    isCurrentCommandIdentity: () => true,
    recoverProtectedCommandFailure: (error, context) => {
      events.push(["recover", error?.httpStatus, context?.id]);
      return overrides.recoverResult === true;
    },
    searchTargets: async (kind, query) => {
      events.push(["search-targets", kind, query]);
      return [{ value: "person-1", label: "Jordan Lee" }];
    },
    api: async (path, request) => {
      events.push(["post", path, request]);
      if (overrides.postError) throw overrides.postError;
      return { id: "created" };
    },
    pageApi: async (path, lifetime) => {
      events.push(["get", path, lifetime]);
      if (overrides.getError) throw overrides.getError;
      return overrides.getResult || { policies: [{ id: "policy-new", targetType: "office", targetId: "office-1" }] };
    },
    requestOptions: (method, payload) => ({ method, payload }),
    errorText: (error) => error?.message || "Request failed.",
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    adminReadIssue: (result) => result?.readError ? { message: "Read issue." } : undefined,
    setMessage: (message, kind) => events.push(["message", message, kind]),
    renderAdminContent: async (currentData, lifetime) => events.push(["render", currentData === data, lifetime]),
    showFeedback: () => events.push(["feedback"]),
  });
  return { data, state, target, route, events };
}

test("adapter derives independent view/manage and target selectors from current org-scoped grants", async () => {
  const harness = await createAdapterHarness([
    { permissionKey: "availability.wfh_policy.view", scope: "organisation" },
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "people.view", scope: "office", officeId: "office-1" },
  ]);
  const props = harness.route.createProps(harness.data);
  assert.equal(props.canView, true);
  assert.equal(props.canManage, true);
  assert.equal(props.policies.authorized, true);
  assert.equal(props.targets.office.authorized, false);
  assert.equal(props.targets.organisation_department.authorized, false);
  assert.equal(props.targets.person.authorized, false);
  assert.deepEqual(props.targets.person.result, { readState: "remote" });
});

test("manage-only adapter keeps create available and skips both the view read and policy list exposure", async () => {
  const harness = await createAdapterHarness([
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ]);
  const props = harness.route.createProps(harness.data);
  assert.equal(props.canView, false);
  assert.equal(props.canManage, true);
  assert.equal(props.policies.authorized, false);
  assert.equal(props.targets.office.authorized, true);

  await props.onCreate({ targetType: "office", targetId: "office-1", allowed: true, effectiveOn: "2026-10-01" });
  assert.deepEqual(harness.events.filter(([kind]) => ["post", "get"].includes(kind)).map(([kind, path]) => [kind, path]), [
    ["post", "/api/availability/wfh-policies"],
  ]);
  assert.equal(harness.events.some(([kind]) => kind === "render"), true);
  assert.equal(harness.state.pendingAdminCommandFocus, true);
});

test("adapter does not filter a selected target through a preloaded list and reports server rejection", async () => {
  const rejected = Object.assign(new Error("WFH_POLICY_TARGET_NOT_FOUND"), { httpStatus: 409 });
  const harness = await createAdapterHarness([
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ], { postError: rejected });
  const props = harness.route.createProps(harness.data);
  harness.data.offices.offices = [];
  await assert.rejects(
    props.onCreate({ targetType: "office", targetId: "00000000-0000-4000-8000-000000000001", allowed: true, effectiveOn: "2026-10-01" }),
    /WFH_POLICY_TARGET_NOT_FOUND/,
  );
  assert.equal(harness.events.some(([kind]) => kind === "post"), true);
});

test("adapter preserves exact POST and view-gated GET contracts and warns before permission recovery", async () => {
  const harness = await createAdapterHarness([
    { permissionKey: "availability.wfh_policy.view", scope: "organisation" },
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "people.view", scope: "organisation" },
  ]);
  const props = harness.route.createProps(harness.data);
  const command = { targetType: "person", targetId: "person-1", allowed: false, effectiveOn: "2026-10-01", reason: "Temporary" };
  await props.onCreate(command);
  assert.deepEqual(harness.events.filter(([kind]) => ["post", "get"].includes(kind)), [
    ["post", "/api/availability/wfh-policies", { method: "POST", payload: command }],
    ["get", "/api/availability/wfh-policies", "page-life"],
  ]);
  assert.deepEqual(harness.data.wfhPolicies.policies, [{ id: "policy-new", targetType: "office", targetId: "office-1" }]);

  const forbiddenRead = Object.assign(new Error("read denied"), { httpStatus: 403, code: "PERMISSION_DENIED" });
  const failedRefresh = await createAdapterHarness([
    { permissionKey: "availability.wfh_policy.view", scope: "organisation" },
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "people.view", scope: "organisation" },
  ], { getError: forbiddenRead, recoverResult: true });
  await failedRefresh.route.createProps(failedRefresh.data).onCreate(command);
  const warningIndex = failedRefresh.events.findIndex(([kind, message]) => kind === "message" && message.includes("latest state is unverified"));
  const recoveryIndex = failedRefresh.events.findIndex(([kind]) => kind === "recover");
  assert.ok(warningIndex >= 0 && warningIndex < recoveryIndex);
  assert.equal(failedRefresh.events.some(([kind]) => kind === "render"), false);
});

test("adapter stops before transport when the Admin snapshot changes", async () => {
  const harness = await createAdapterHarness([
    { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
  ]);
  const props = harness.route.createProps(harness.data);
  harness.state.adminData = { actorGrants: { grants: [] } };
  await assert.rejects(
    props.onCreate({ targetType: "office", targetId: "office-1", allowed: true, effectiveOn: "2026-10-01" }),
    /Admin page changed/,
  );
  assert.equal(harness.events.some(([kind]) => kind === "post"), false);
});
