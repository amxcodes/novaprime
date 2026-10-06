import { expect, test } from "bun:test";
import { planPersonLifecycleCapabilities } from "./lifecycle-capabilities";
import type { PersonDirectoryRecord } from "./contracts";

const person: PersonDirectoryRecord = {
  id: "person-1",
  displayName: "Aman",
  email: "aman@example.test",
  status: "active",
  designation: null,
  employmentStartsOn: null,
  managerName: null,
  office: { id: "office-1", name: "North" },
  department: { id: "department-1", name: "People" },
  role: { id: "role-1", name: "Member" },
};

const none = {
  canFreeze: false,
  canStartOffboarding: false,
  canCompleteOffboarding: false,
};

test("no record, missing grants, and invite-only grants expose no lifecycle action", () => {
  expect(planPersonLifecycleCapabilities({ grants: [] }, null)).toEqual(none);
  expect(planPersonLifecycleCapabilities(undefined, person)).toEqual(none);
  expect(planPersonLifecycleCapabilities({ grants: [
    { permissionKey: "people.invite", scope: "organisation" },
  ] }, person)).toEqual(none);
});

test("view-only access does not imply freeze or offboarding", () => {
  expect(planPersonLifecycleCapabilities({ grants: [
    { permissionKey: "people.view", scope: "organisation" },
  ] }, person)).toEqual(none);
});

test("operation-only grants do not become a person locator or expose lifecycle actions", () => {
  expect(planPersonLifecycleCapabilities({ grants: [
    { permissionKey: "people.freeze", scope: "organisation" },
    { permissionKey: "people.offboard", scope: "organisation" },
  ] }, person)).toEqual(none);
});

test("matching office and department grants expose only their corresponding actions", () => {
  expect(planPersonLifecycleCapabilities({ grants: [
    { permissionKey: "people.view", scope: "office", officeId: "office-1" },
    { permissionKey: "people.freeze", scope: "office", officeId: "office-1" },
  ] }, person)).toEqual({ ...none, canFreeze: true });
  expect(planPersonLifecycleCapabilities({ grants: [
    { permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: "department-1" },
    { permissionKey: "people.offboard", scope: "organisation_department", organisationDepartmentId: "department-1" },
  ] }, person)).toEqual({ ...none, canStartOffboarding: true });
});

test("a grant scoped to a different target cannot expose a lifecycle action", () => {
  expect(planPersonLifecycleCapabilities({ grants: [
    { permissionKey: "people.view", scope: "organisation" },
    { permissionKey: "people.freeze", scope: "office", officeId: "office-2" },
    { permissionKey: "people.offboard", scope: "organisation_department", organisationDepartmentId: "department-2" },
  ] }, person)).toEqual(none);
});

test("action availability follows server-returned lifecycle state and target grant", () => {
  const grants = { grants: [
    { permissionKey: "people.view", scope: "organisation" },
    { permissionKey: "people.freeze", scope: "organisation" },
    { permissionKey: "people.offboard", scope: "organisation" },
  ] };
  expect(planPersonLifecycleCapabilities(grants, person)).toEqual({
    canFreeze: true,
    canStartOffboarding: true,
    canCompleteOffboarding: false,
  });
  expect(planPersonLifecycleCapabilities(grants, { ...person, status: "offboarding" })).toEqual({
    canFreeze: false,
    canStartOffboarding: false,
    canCompleteOffboarding: true,
  });
  expect(planPersonLifecycleCapabilities(grants, { ...person, status: "exited" })).toEqual(none);
});
