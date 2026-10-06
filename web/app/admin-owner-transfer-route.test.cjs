const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const adminPageRouteSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "admin-owner-transfer-route.js"), "utf8");
const sectionsSource = fs.readFileSync(path.join(__dirname, "../src/pages/admin/admin-page-sections.ts"), "utf8");
const capabilitySource = fs.readFileSync(path.join(__dirname, "../src/features/admin/capabilities.ts"), "utf8");

test("Owner Transfer UI and host adapter load only behind Super Admin plus organization People access", () => {
  assert.match(capabilitySource, /export function canShowOwnerTransfer[\s\S]*?read\?\.isSuperAdmin === true[\s\S]*?Array\.isArray\(read\.grants\)/);
  assert.match(capabilitySource, /export function canShowOwnerTransfer[\s\S]*?canViewAdminPeople\(read\)/);
  assert.match(adminPageRouteSource, /loadAdminFeatureModule\(canShowOwnerTransfer\(data\.actorGrants\), \(\) => import\("\.\.\/src\/features\/admin\/owner-transfer\/index\.ts"\)\)/);
  assert.match(adminPageRouteSource, /loadAdminFeatureModule\(canShowOwnerTransfer\(data\.actorGrants\), \(\) => import\("\.\/admin-owner-transfer-route\.js"\)\)/);
  assert.match(adminPageRouteSource, /state\.adminData !== data\) return;[\s\S]*?canShowOwnerTransfer\(state\.adminData\?\.actorGrants\)/);
  assert.match(adminPageRouteSource, /"owner-transfer": OwnerTransfer && ownerTransferRoute[\s\S]*?createElement\(OwnerTransfer, ownerTransferRoute\.createProps\(data\)\)/);
  assert.match(sectionsSource, /\["owner-transfer", canShowOwnerTransfer\(read\)\]/);
  assert.doesNotMatch(adminPageRouteSource, /mountAdminOwnerTransfer|projectOwnerTransferRead|mountReactIsland\(target, OwnerTransfer/);
});

test("adapter requires its host-owned Admin services", async () => {
  const { createOwnerTransferRoute } = await import("./admin-owner-transfer-route.js");
  assert.throws(() => createOwnerTransferRoute(), /isCurrentPageRequest must be a function/);
});

function grants({ superAdmin = true, roster = true, rosterScope = "organisation" } = {}) {
  return {
    isSuperAdmin: superAdmin,
    actorPersonId: "person-self",
    grants: roster ? [{ permissionKey: "people.view", scope: rosterScope, ...(rosterScope === "office" ? { officeId: "office-7" } : {}) }] : [],
  };
}

async function createHarness(options = {}) {
  const { createOwnerTransferRoute } = await import("./admin-owner-transfer-route.js");
  const events = [];
  const data = {
    actorGrants: options.actorGrants || grants(),
    people: options.people || { people: [
      { id: "person-self", status: "active", displayName: "Current owner" },
      { id: "person-active", status: "active", displayName: "Alex Rivera" },
      { id: "person-notice", status: "notice", email: "notice@example.test" },
      { id: "person-frozen", status: "frozen", displayName: "Frozen person" },
    ] },
  };
  const state = { adminData: data };
  const target = { isConnected: true };
  const lifetime = { id: "admin-lifetime" };
  const route = createOwnerTransferRoute({
    state,
    target,
    lifetime,
    isCurrentPageRequest: (value) => value === lifetime && options.pageCurrent !== false,
    canViewAdminPeople: (read) => read?.grants?.some((grant) =>
      grant.permissionKey === "people.view" && grant.scope === "organisation") === true,
    runAdminProtectedCommand: (...args) => {
      events.push(["command", ...args]);
      return Promise.resolve(options.commandResult);
    },
    renderAdmin: (value) => events.push(["retry", value]),
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
  });
  return { data, state, target, lifetime, route, events };
}

test("only organization people.view supplies safe active or notice choices; raw IDs stay host-owned", async () => {
  const allowed = await createHarness();
  const props = allowed.route.createProps(allowed.data);
  assert.equal(props.canTransfer, true);
  assert.equal(props.read.status, "ready");
  assert.deepEqual(props.read.choices.map(({ label }) => label), ["Alex Rivera", "notice@example.test"]);
  assert.ok(props.read.choices.every((choice) => !Object.hasOwn(choice, "id")));
  assert.doesNotMatch(JSON.stringify(props.read.choices.map(({ label }) => label)), /person-(?:self|active|notice|frozen)/);

  const scopedOnly = await createHarness({ actorGrants: grants({ rosterScope: "office" }) });
  const scopedProps = scopedOnly.route.createProps(scopedOnly.data);
  assert.equal(scopedProps.canTransfer, false);
  assert.equal(scopedProps.read.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(scopedProps.read), /person-(?:self|active|notice|frozen)/);
});

test("adapter fails closed for an ordinary role and an unrequested roster", async () => {
  const ordinary = await createHarness({ actorGrants: grants({ superAdmin: false }) });
  assert.equal(ordinary.route.createProps(ordinary.data).canTransfer, false);
  assert.equal(ordinary.route.createProps(ordinary.data).read.status, "unavailable");

  const noRoster = await createHarness({ actorGrants: grants({ roster: false }) });
  const props = noRoster.route.createProps(noRoster.data);
  assert.equal(props.canTransfer, false);
  assert.equal(props.read.status, "unavailable");
  assert.equal(props.read.choices, undefined);
});

test("the exact guarded POST contract preserves ambiguous-result messaging", async () => {
  const harness = await createHarness();
  const props = harness.route.createProps(harness.data);
  await props.read.choices[0].transfer();
  const [, target, lifetime, livePermission, permissionTarget, method, endpoint, body, success, afterSuccess, headers, ambiguous] = harness.events[0];
  assert.equal(target, harness.target);
  assert.equal(lifetime, harness.lifetime);
  assert.equal(typeof livePermission, "function");
  assert.equal(livePermission(harness.state.adminData), true);
  assert.deepEqual(permissionTarget, {});
  assert.equal(method, "POST");
  assert.equal(endpoint, "/api/organisation/owner-transfer");
  assert.deepEqual(body, { targetPersonId: "person-active", confirmation: "TRANSFER SUPER ADMIN" });
  assert.equal(success, "Ownership transferred. Your current sessions may now be revoked.");
  assert.equal(afterSuccess, undefined);
  assert.equal(headers, undefined);
  assert.equal(ambiguous, "NOVA could not confirm whether ownership transferred. Your session may have been revoked. Refresh and verify the current Super Admin before retrying.");
});

test("commands stop if the Admin snapshot, live Super Admin status, roster access, or eligible target changes", async () => {
  const snapshotChanged = await createHarness();
  const snapshotChoice = snapshotChanged.route.createProps(snapshotChanged.data).read.choices[0];
  snapshotChanged.state.adminData = { ...snapshotChanged.data };
  assert.throws(() => snapshotChoice.transfer(), /page or Super Admin access changed/);
  assert.equal(snapshotChanged.events.length, 0);

  const roleChanged = await createHarness();
  const roleChoice = roleChanged.route.createProps(roleChanged.data).read.choices[0];
  roleChanged.data.actorGrants.isSuperAdmin = false;
  assert.throws(() => roleChoice.transfer(), /page or Super Admin access changed/);
  assert.equal(roleChanged.events.length, 0);

  const rosterChanged = await createHarness();
  const rosterChoice = rosterChanged.route.createProps(rosterChanged.data).read.choices[0];
  rosterChanged.data.actorGrants.grants = [];
  assert.throws(() => rosterChoice.transfer(), /grants no longer include the people list/);
  assert.equal(rosterChanged.events.length, 0);

  const targetChanged = await createHarness();
  const targetChoice = targetChanged.route.createProps(targetChanged.data).read.choices[0];
  targetChanged.data.people.people[1].status = "frozen";
  assert.throws(() => targetChoice.transfer(), /no longer an eligible owner/);
  assert.equal(targetChanged.events.length, 0);
});

test("page freshness gates transfer and retry uses the current Admin page lifetime", async () => {
  const harness = await createHarness({ pageCurrent: false });
  const props = harness.route.createProps(harness.data);
  assert.equal(props.canTransfer, false);
  assert.equal(props.read.status, "unavailable");
  await props.onRetry();
  assert.deepEqual(harness.events, [["retry", harness.lifetime]]);
});
