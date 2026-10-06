import { expect, test } from "bun:test";
import {
  createPersonLifecycleActions,
  createPeopleLifecyclePageActionProvider,
} from "./people-lifecycle-host.js";

const person = {
  id: "person-1",
  displayName: "Aman",
  email: "aman@example.test",
  status: "active",
  office: { id: "office-1", name: "North" },
  department: { id: "department-1", name: "People" },
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requestedPersonId: person.id,
    person,
    actorGrants: { grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-1" },
      { permissionKey: "people.freeze", scope: "office", officeId: "office-1" },
    ] },
    isCurrent: () => true,
    hasPermission: () => true,
    submit: async () => {},
    readPerson: async () => person,
    canRun: () => true,
    captureContext: () => ({ actorPersonId: "actor-1" }),
    isContextCurrent: () => true,
    recoverProtectedFailure: () => false,
    ...overrides,
  };
}

test("host projects only the lifecycle capability granted for the same readable person", () => {
  const actions = createPersonLifecycleActions(dependencies());
  expect(actions).toMatchObject({
    canFreeze: true,
    canStartOffboarding: false,
    canCompleteOffboarding: false,
  });
  expect(typeof actions?.onFreeze).toBe("function");
  expect(typeof actions?.onStartOffboarding).toBe("function");
});

test("host fails closed for mismatched target, invite-only, and view-only grants", () => {
  expect(createPersonLifecycleActions(dependencies({ requestedPersonId: "person-2" }))).toBeUndefined();
  expect(createPersonLifecycleActions(dependencies({ actorGrants: { grants: [
    { permissionKey: "people.invite", scope: "organisation" },
  ] } }))).toBeUndefined();
  expect(createPersonLifecycleActions(dependencies({ actorGrants: { grants: [
    { permissionKey: "people.view", scope: "organisation" },
  ] } }))).toBeUndefined();
});

test("page provider binds an exact read, authenticated write, identity guard, and scoped grant", async () => {
  const calls: Array<[string, unknown]> = [];
  const grants = dependencies().actorGrants;
  const provider = createPeopleLifecyclePageActionProvider({
    requestedPersonId: person.id,
    lifetime: { id: "lifetime-1" },
    pageRoot: { isConnected: true },
    getActorGrants: () => grants,
    getIdentityEpoch: () => 4,
    getActorPersonId: () => "actor-1",
    isCurrentPageRequest: () => true,
    hasPermissionGrant: (_read, permission, target) => {
      calls.push(["grant", { permission, target }]);
      return true;
    },
    api: async (path, options) => { calls.push(["write", { path, options }]); },
    requestOptions: (method, payload) => ({ method, payload }),
    pageApi: async (path, lifetime) => {
      calls.push(["read", { path, lifetime }]);
      return { person };
    },
    captureCommandContext: (source) => ({ source, identityEpoch: 4 }),
    isCurrentCommand: () => true,
    recoverProtectedCommandFailure: () => false,
    refreshActorPermissions: () => {},
    setMessage: () => {},
    render: () => {},
    mapError: () => "safe error",
  });
  const actions = provider(person);
  expect(provider(person)).toBe(actions);
  expect(actions?.canFreeze).toBe(true);
  expect((await actions?.onFreeze())?.status).toBe("success");
  expect(calls[0]?.[0]).toBe("read");
  expect(calls[1]?.[0]).toBe("grant");
  expect(calls[2]?.[0]).toBe("write");
  expect(calls[2]?.[1]).toMatchObject({
    path: "/api/people/person-1/freeze",
    options: { method: "POST", payload: { reason: "Frozen by administrator" } },
  });
});
