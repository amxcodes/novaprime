const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPersonLifecycleRoute, personLifecycleRouteMessages } = require("./people-lifecycle-route.js");

const person = {
  id: "person-1",
  office: { id: "office-1" },
  department: { id: "department-1" },
};

function route(overrides = {}) {
  const calls = { submitted: [], grants: [], reads: [], refreshed: [], successes: [], recovered: [] };
  const dependencies = {
    requestedPersonId: person.id,
    person,
    isCurrent: () => true,
    hasPermission: (permission, target) => { calls.grants.push({ permission, target }); return true; },
    submit: async (path, payload) => { calls.submitted.push({ path, payload }); },
    readPerson: async (personId) => { calls.reads.push(personId); return person; },
    canRun: () => true,
    captureContext: () => ({ actorPersonId: "actor-1" }),
    isContextCurrent: () => true,
    recoverProtectedFailure: (error, context, message) => {
      calls.recovered.push({ error, context, message });
      return error.httpStatus === 401 || error.httpStatus === 403;
    },
    refreshAccess: (message) => calls.refreshed.push(message),
    onSuccess: (message, personId) => calls.successes.push({ message, personId }),
    mapError: (error) => error.uiMessage || "This action could not be completed.",
    ...overrides,
  };
  return { controller: createPersonLifecycleRoute(dependencies), calls };
}

test("freeze checks the exact target and preserves the existing route and payload", async () => {
  const { controller, calls } = route();
  assert.deepEqual(await controller.onFreeze(), {
    status: "success",
    message: "Person frozen and existing sessions revoked.",
  });
  assert.deepEqual(calls.grants, [{
    permission: "people.freeze",
    target: { personId: "person-1", officeId: "office-1", organisationDepartmentId: "department-1" },
  }]);
  assert.deepEqual(calls.submitted, [{
    path: "/api/people/person-1/freeze",
    payload: { reason: "Frozen by administrator" },
  }]);
  assert.deepEqual(calls.reads, ["person-1"]);
  assert.equal(calls.successes[0].personId, "person-1");
});

test("fresh target assignments and lifecycle state are rechecked before a write", async () => {
  const movedPerson = {
    ...person,
    office: { id: "office-2" },
    department: { id: "department-2" },
  };
  const moved = route({ readPerson: async () => movedPerson });
  assert.equal((await moved.controller.onFreeze()).status, "success");
  assert.deepEqual(moved.calls.grants, [{
    permission: "people.freeze",
    target: { personId: "person-1", officeId: "office-2", organisationDepartmentId: "department-2" },
  }]);

  const lostScope = route({
    readPerson: async () => movedPerson,
    hasPermission: (_permission, target) => target.officeId === "office-1",
  });
  assert.equal((await lostScope.controller.onFreeze()).status, "error");
  assert.equal(lostScope.calls.submitted.length, 0);
  assert.deepEqual(lostScope.calls.refreshed, [personLifecycleRouteMessages.accessChanged]);

  const noLongerEligible = route({ canRun: () => false });
  assert.equal((await noLongerEligible.controller.onStartOffboarding("reason")).status, "error");
  assert.equal(noLongerEligible.calls.submitted.length, 0);
  assert.deepEqual(noLongerEligible.calls.refreshed, [personLifecycleRouteMessages.accessChanged]);
});

test("start and complete offboarding keep their existing payload distinction", async () => {
  const { controller, calls } = route();
  await controller.onStartOffboarding("Move active work to the new owner.");
  await controller.onCompleteExit("The final day has passed.");

  assert.deepEqual(calls.submitted, [
    { path: "/api/people/person-1/offboard", payload: { reason: "Move active work to the new owner." } },
    { path: "/api/people/person-1/offboard", payload: { final: true, reason: "The final day has passed." } },
  ]);
  assert.deepEqual(calls.grants.map(({ permission }) => permission), ["people.offboard", "people.offboard"]);
});

test("mismatched person, stale page, invite-only, and view-only state never submit", async () => {
  const mismatched = route({ requestedPersonId: "person-2" });
  assert.equal((await mismatched.controller.onFreeze()).status, "error");
  assert.equal(mismatched.calls.submitted.length, 0);

  const stale = route({ isCurrent: () => false });
  assert.equal((await stale.controller.onStartOffboarding("reason")).status, "error");
  assert.equal(stale.calls.submitted.length, 0);

  for (const permission of [null, "people.invite", "people.view"]) {
    const denied = route({
      hasPermission: (key) => key === permission,
    });
    const result = await denied.controller.onFreeze();
    assert.equal(result.status, "error");
    assert.equal(denied.calls.submitted.length, 0);
    assert.deepEqual(denied.calls.refreshed, [personLifecycleRouteMessages.accessChanged]);
  }
});

test("scoped conflicts return mapped feedback without an optimistic success", async () => {
  const conflict = Object.assign(new Error("conflict"), { code: "ACTIVE_ASSIGNMENTS_REMAIN", httpStatus: 409, uiMessage: "Reassign or close active assignments first." });
  const { controller, calls } = route({ submit: async () => { throw conflict; } });
  const result = await controller.onCompleteExit("Reason.");

  assert.deepEqual(result, { status: "error", message: "Reassign or close active assignments first." });
  assert.equal(calls.successes.length, 0);
  assert.equal(calls.recovered.length, 1);
});

test("protected failures refresh current access and do not report command success", async () => {
  const forbidden = Object.assign(new Error("forbidden"), { httpStatus: 403 });
  const { controller, calls } = route({ submit: async () => { throw forbidden; } });
  const result = await controller.onFreeze();

  assert.equal(result.status, "error");
  assert.deepEqual(calls.recovered, [{
    error: forbidden,
    context: { actorPersonId: "actor-1" },
    message: personLifecycleRouteMessages.accessChanged,
  }]);
  assert.equal(calls.successes.length, 0);
});

test("401 protected failures use recovery, while unknown messages never expose raw errors", async () => {
  const unauthorized = Object.assign(new Error("provider secret detail"), { httpStatus: 401 });
  const recovered = route({ submit: async () => { throw unauthorized; } });
  assert.equal((await recovered.controller.onFreeze()).status, "error");
  assert.equal(recovered.calls.recovered.length, 1);

  const raw = Object.assign(new Error("database and provider detail"), { code: "UNKNOWN" });
  const safe = route({ submit: async () => { throw raw; }, mapError: undefined });
  assert.deepEqual(await safe.controller.onFreeze(), {
    status: "error",
    message: "The action could not be completed. Refresh this person record and try again.",
  });
});

test("the mount identity is captured once and success effect errors cannot misreport a committed write", async () => {
  let routeContextCurrent = true;
  const stale = route({ isContextCurrent: () => routeContextCurrent });
  routeContextCurrent = false;
  assert.equal((await stale.controller.onFreeze()).status, "error");
  assert.equal(stale.calls.reads.length, 0);
  assert.equal(stale.calls.submitted.length, 0);

  const committed = route({ onSuccess: () => { throw new Error("render failed"); } });
  assert.deepEqual(await committed.controller.onFreeze(), {
    status: "success",
    message: "Person frozen and existing sessions revoked.",
  });
});

test("construction requires current page, identity, scope, and target-read guards", () => {
  assert.throws(() => createPersonLifecycleRoute({ requestedPersonId: person.id, person }), /isCurrent must be a function/);
});

test("identity or page changes after a write suppress success callbacks", async () => {
  let current = true;
  const { controller, calls } = route({
    submit: async () => { current = false; },
    isCurrent: () => current,
  });
  assert.equal((await controller.onFreeze()).status, "error");
  assert.equal(calls.successes.length, 0);
});

test("identity or page changes during the fresh-person read suppress the write", async () => {
  let current = true;
  const { controller, calls } = route({
    readPerson: async (personId) => {
      calls.reads.push(personId);
      current = false;
      return person;
    },
    isCurrent: () => current,
  });
  assert.equal((await controller.onFreeze()).status, "error");
  assert.deepEqual(calls.reads, [person.id]);
  assert.equal(calls.submitted.length, 0);
  assert.equal(calls.successes.length, 0);
});
