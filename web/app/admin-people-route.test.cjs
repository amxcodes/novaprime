const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const routeSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");
const sectionsSource = fs.readFileSync(path.join(__dirname, "../src/pages/admin/admin-page-sections.ts"), "utf8");

test("Admin loads People as a typed lazy child only for organization invite or view grants", () => {
  assert.match(routeSource, /loadAdminFeatureModule\(canInviteAdminPeople\(data\.actorGrants\) \|\| canViewAdminPeople\(data\.actorGrants\), \(\) => import\("\.\.\/src\/features\/admin\/PeopleAdministrationSection\.tsx"\)\)/);
  assert.match(routeSource, /loadAdminFeatureModule\(canInviteAdminPeople\(data\.actorGrants\) \|\| canViewAdminPeople\(data\.actorGrants\), \(\) => import\("\.\/admin-people-route\.js"\)\)/);
  assert.match(routeSource, /identityEpoch !== state\.identityEpoch \|\| state\.adminData !== data\) return;/);
  assert.match(routeSource, /canInviteAdminPeople\(state\.adminData\?\.actorGrants\) \|\|\s*canViewAdminPeople\(state\.adminData\?\.actorGrants\)[\s\S]*?peopleModule\?\.PeopleAdministrationSection/);
  assert.match(routeSource, /people: PeopleAdministrationSection && peopleRoute\s*\? createElement\(PeopleAdministrationSection, peopleRoute\.createProps\(data\)\)\s*: createElement\(PeopleAdministrationLoadFailureSection\)/);
  assert.match(sectionsSource, /\["people", canInviteAdminPeople\(read\) \|\| canViewAdminPeople\(read\)\]/);
  assert.doesNotMatch(routeSource, /renderAdminPeopleSection|mountAdminPeopleAdministration|mountReactIsland\(target, PeopleAdministration/);
});

function grant(permissionKey, scope = "organisation", target = {}) {
  return { permissionKey, scope, ...target };
}

function hasPermissionGrant(read, permissionKey, target = {}) {
  if (read?.readError || !Array.isArray(read?.grants)) return false;
  return read.grants.some((item) => item.permissionKey === permissionKey && (
    item.scope === "organisation" ||
    (item.scope === "own_record" && target.personId === read.actorPersonId) ||
    (item.scope === "office" && target.officeId === item.officeId) ||
    (item.scope === "organisation_department" && target.organisationDepartmentId === item.organisationDepartmentId)
  ));
}

function canInviteAdminPeople(read) {
  return Array.isArray(read?.grants) && read.grants.some((item) =>
    item.permissionKey === "people.invite" && item.scope === "organisation");
}

function canViewAdminPeople(read) {
  return Array.isArray(read?.grants) && read.grants.some((item) =>
    item.permissionKey === "people.view" && item.scope === "organisation");
}

async function createHarness(grants, options = {}) {
  const { createAdminPeopleRoute } = await import("./admin-people-route.js");
  const events = [];
  const data = {
    actorGrants: { actorPersonId: "person-self", grants },
    people: options.people || { readState: canViewAdminPeople({ grants }) ? "ready" : "not-requested", people: [
      { id: "person-self", displayName: "Self", email: "self@example.test", status: "active", office: { id: "office-1", name: "Central" }, department: { id: "department-1", name: "People" } },
      { id: "person-active", displayName: "Alex Rivera", email: "alex@example.test", status: "active", office: { id: "office-1", name: "Central" }, department: { id: "department-1", name: "People" } },
      { id: "person-invited", displayName: "Sam Lee", email: "sam@example.test", status: "invited" },
      { id: "person-onboarding", displayName: "Taylor", email: "taylor@example.test", status: "onboarding" },
      { id: "person-offboarding", displayName: "Morgan", email: "morgan@example.test", status: "offboarding", office: { id: "office-1", name: "Central" }, department: { id: "department-1", name: "People" } },
    ] },
    offices: { offices: [{ id: "office-1", name: "Central", timezone: "Asia/Kolkata" }] },
    departments: { departments: [{ id: "department-1", name: "People" }] },
    roles: { roles: [
      { id: "role-member", name: "Member" },
      { id: "role-protected", name: "Owner", isProtected: true },
      { id: "role-archived", name: "Legacy", archivedAt: "2026-01-01" },
    ] },
  };
  const state = { adminData: data, identityEpoch: 4 };
  const target = { isConnected: true };
  const lifetime = { id: "admin-people-lifetime" };
  const route = createAdminPeopleRoute({
    state,
    target,
    lifetime,
    identityEpoch: state.identityEpoch,
    isCurrentPageRequest: (value) => value === lifetime && options.pageCurrent !== false,
    canInviteAdminPeople: (read) => canInviteAdminPeople(read),
    canViewAdminPeople: (read) => canViewAdminPeople(read),
    hasPermissionGrant,
    adminReadIssue: (result, resource) => result?.readError
      ? { message: `${resource} unavailable.` }
      : undefined,
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
    runProtectedCommand: (permissionCheck, permissionTarget, endpoint, payload, successMessage, afterSuccess) => {
      events.push(["command", endpoint, payload, successMessage]);
      if (!permissionCheck(state.adminData)) throw new Error("Live access rejected.");
      const result = endpoint === "/api/people/invitations"
        ? { delivery: "sent", status: "sent" }
        : { ok: true };
      afterSuccess?.(result);
      return Promise.resolve(result);
    },
    describeInvitationFeedback: (result) => ({ delivery: result.delivery, kind: "success", message: "Invitation sent." }),
    reflectInvitationDelivery: (...args) => events.push(["delivery", ...args]),
    errorText: (error) => error?.message || "Request failed.",
  });
  return { data, state, target, lifetime, route, events };
}

test("invite-only and scoped viewers never receive an unpaged People roster projection", async () => {
  const inviteOnly = await createHarness([grant("people.invite")]);
  const inviteProps = inviteOnly.route.createProps(inviteOnly.data);
  assert.equal(inviteProps.canInvite, true);
  assert.equal(inviteProps.canViewPeople, false);
  assert.deepEqual(inviteProps.people, []);
  assert.equal(inviteProps.peopleRead.status, "unavailable");

  const scoped = await createHarness([
    grant("people.view", "office", { officeId: "office-1" }),
    grant("people.freeze", "office", { officeId: "office-1" }),
  ]);
  const scopedProps = scoped.route.createProps(scoped.data);
  assert.equal(scopedProps.canViewPeople, false);
  assert.deepEqual(scopedProps.people, []);
  assert.doesNotMatch(JSON.stringify(scopedProps), /person-(?:self|active|invited|onboarding|offboarding)/);
});

test("self freeze and offboarding stay omitted even when the actor has own_record action grants", async () => {
  const harness = await createHarness([
    grant("people.view"),
    grant("people.freeze", "own_record", { selfApplicable: true }),
    grant("people.offboard", "own_record", { selfApplicable: true }),
  ]);
  const props = harness.route.createProps(harness.data);
  const self = props.people.find((person) => person.id === "person-self");
  const other = props.people.find((person) => person.id === "person-active");
  assert.deepEqual(self.actions, {
    resendInvitation: false,
    freeze: false,
    startOffboarding: false,
    completeExit: false,
    completeOnboarding: false,
  });
  assert.equal(other.actions.freeze, false);
  assert.equal(other.actions.startOffboarding, false);

  assert.throws(() => props.onFreeze("person-self"), /no longer available/);
  assert.throws(() => props.onStartOffboarding("person-self", "reason"), /no longer available/);
  assert.equal(harness.events.length, 0);
});

test("target-scoped freeze and offboarding preserve distinct current-target commands", async () => {
  const harness = await createHarness([
    grant("people.view"),
    grant("people.freeze", "office", { officeId: "office-1" }),
    grant("people.offboard", "organisation_department", { organisationDepartmentId: "department-1" }),
  ]);
  const props = harness.route.createProps(harness.data);
  const target = props.people.find((person) => person.id === "person-active");
  assert.equal(target.actions.freeze, true);
  assert.equal(target.actions.startOffboarding, true);
  await props.onFreeze("person-active");
  await props.onStartOffboarding("person-active", "Role change");
  await props.onCompleteExit("person-offboarding", "Final check");
  assert.deepEqual(harness.events.filter(([kind]) => kind === "command").map(([, endpoint, payload]) => [endpoint, payload]), [
    ["/api/people/person-active/freeze", { reason: "Frozen by administrator" }],
    ["/api/people/person-active/offboard", { reason: "Role change" }],
    ["/api/people/person-offboarding/offboard", { final: true, reason: "Final check" }],
  ]);
});

test("invite-only mutations preserve delivery handoff and snapshot freshness", async () => {
  const harness = await createHarness([grant("people.invite")]);
  const props = harness.route.createProps(harness.data);
  const feedback = await props.onInvite({ displayName: "Jordan Lee", email: "jordan@example.test" });
  assert.deepEqual(feedback, { delivery: "sent", kind: "success", message: "Invitation sent." });
  assert.deepEqual(harness.events.filter(([kind]) => kind === "command").map(([, endpoint, payload]) => [endpoint, payload]), [
    ["/api/people/invitations", { displayName: "Jordan Lee", email: "jordan@example.test" }],
  ]);
  assert.equal(harness.events.some(([kind]) => kind === "delivery"), true);

  const changed = await createHarness([grant("people.invite")]);
  const staleProps = changed.route.createProps(changed.data);
  changed.state.adminData = { ...changed.data };
  await assert.rejects(staleProps.onInvite({ displayName: "Jordan Lee", email: "jordan@example.test" }), /Admin page changed/);
  assert.equal(changed.events.length, 0);
});

test("onboarding selectors are read independently and current authorized choices are rechecked", async () => {
  const grants = [
    grant("people.view"),
    grant("people.edit"),
    grant("people.activate"),
    grant("roles.assign"),
  ];
  const denied = await createHarness(grants);
  const deniedRow = denied.route.createProps(denied.data).people.find((person) => person.id === "person-onboarding");
  assert.equal(deniedRow.actions.completeOnboarding, true);
  assert.equal(deniedRow.onboarding.status, "denied");
  assert.equal("offices" in deniedRow.onboarding, false);
  assert.equal("roles" in deniedRow.onboarding, false);

  const allowed = await createHarness([
    ...grants,
    grant("organisation.settings.manage"),
    grant("roles.view"),
  ]);
  const props = allowed.route.createProps(allowed.data);
  const row = props.people.find((person) => person.id === "person-onboarding");
  assert.equal(row.onboarding.status, "ready");
  assert.deepEqual(row.onboarding.roles, [{ id: "role-member", name: "Member" }]);
  assert.deepEqual(row.onboarding.managers.map((manager) => manager.id), ["person-self", "person-active"]);

  const input = {
    designation: "Operations associate",
    officeId: "office-1",
    employmentStartsOn: "2026-10-05",
    organisationDepartmentId: "department-1",
    roleId: "role-member",
    managerPersonId: "person-active",
  };
  await props.onCompleteOnboarding("person-onboarding", input);
  assert.deepEqual(allowed.events.find(([kind]) => kind === "command").slice(1), [
    "/api/people/person-onboarding/complete-onboarding",
    { ...input },
    "Onboarding completed.",
  ]);

  allowed.data.roles.roles = [];
  assert.throws(() => props.onCompleteOnboarding("person-onboarding", input), /Choose current office/);
  assert.equal(allowed.events.filter(([kind]) => kind === "command").length, 1);
});
