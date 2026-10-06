const assert = require("node:assert/strict");
const { test } = require("node:test");

function hasGrant(read, key) {
  return Array.isArray(read?.grants) && read.grants.some((grant) =>
    grant.permissionKey === key && grant.scope === "organisation");
}

async function harness({ grants = [], result, pageCurrent = true } = {}) {
  const { createAvailabilityPickerSearchRoute } = await import("./admin-availability-picker-search-route.js");
  const events = [];
  const data = { actorGrants: { grants } };
  const state = { adminData: data };
  const target = { isConnected: true };
  const route = createAvailabilityPickerSearchRoute({
    state,
    target,
    lifetime: "page-life",
    isCurrentPageRequest: () => pageCurrent,
    hasPermissionGrant: hasGrant,
    pageApi: async (path, lifetime) => {
      events.push(["read", path, lifetime]);
      return result || { options: [{ id: "office-1", label: "Central" }] };
    },
    captureCommandContext: () => ({ id: "request-context" }),
    isCurrentCommand: () => true,
    isCurrentCommandIdentity: () => true,
    errorText: (error) => error?.message || "Request failed.",
    recoverProtectedCommandFailure: (error, context) => { events.push(["recover", error?.httpStatus, context?.id]); return true; },
    adminCommandUiError: (message) => Object.assign(new Error(message), { uiMessage: true }),
  });
  return { data, state, target, route, events };
}

test("office searches keep calendar and holiday grants independent and return minimal options", async () => {
  const calendarOnly = await harness({ grants: [
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
    { permissionKey: "availability.calendar.manage", scope: "organisation" },
  ] });
  assert.deepEqual(await calendarOnly.route.searchOffices("calendar", "Central HQ"), [
    { value: "office-1", label: "Central" },
  ]);
  assert.deepEqual(calendarOnly.events, [[
    "read", "/api/availability/configuration-targets?kind=office&purpose=calendar&q=Central+HQ", "page-life",
  ]]);
  await assert.rejects(calendarOnly.route.searchOffices("holiday", "Central"), /access changed/);
  assert.equal(calendarOnly.events.length, 1);

  const shiftOnly = await harness({ grants: [
    { permissionKey: "availability.calendar.manage", scope: "organisation" },
  ] });
  assert.deepEqual(await shiftOnly.route.searchShifts("Standard"), [{ value: "office-1", label: "Central" }]);
  assert.equal(shiftOnly.events[0][1], "/api/availability/configuration-targets?kind=shift&purpose=calendar&q=Standard");
});

test("target searches fail closed for stale pages, malformed input, and unsafe responses", async () => {
  const grants = [
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
    { permissionKey: "availability.calendar.manage", scope: "organisation" },
    { permissionKey: "availability.holiday.manage", scope: "organisation" },
  ];
  const denied = await harness({ grants: [{ permissionKey: "organisation.settings.manage", scope: "organisation" }] });
  await assert.rejects(denied.route.searchOffices("calendar", "Central"), /access changed/);
  assert.equal(denied.events.length, 0);
  await assert.rejects(denied.route.searchOffices("other", "Central"), /invalid/);
  await assert.rejects(denied.route.searchShifts("x".repeat(101)), /invalid/);

  const stale = await harness({ grants, pageCurrent: false });
  await assert.rejects(stale.route.searchOffices("calendar", "Central"), /access changed/);
  assert.equal(stale.events.length, 0);

  const malformed = await harness({ grants, result: { options: [{ id: "office-1" }] } });
  await assert.rejects(malformed.route.searchOffices("calendar", "Central"), /invalid/);
});
