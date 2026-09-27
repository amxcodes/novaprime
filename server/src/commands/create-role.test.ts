import { expect, test } from "bun:test";
import { createRoleInput, updateRoleInput } from "./create-role";

const policy = {
  workEnabled: true,
  canReceiveAssignments: true,
  attendanceRequired: false,
  wfhAllowed: true,
  canWorkWithoutAttendance: true,
  payrollApplicable: false,
  payrollAttendanceContributes: false,
  payrollOvertimeApplicable: false,
};

test("accepts a custom role with explicit grants and every operational policy choice", () => {
  expect(createRoleInput({
    key: "people_lead",
    name: " People Lead ",
    permissionGrants: [{ permissionKey: "people.view", scope: "organisation" }],
    operationalPolicy: policy,
  })).toEqual({
    key: "people_lead",
    name: "People Lead",
    permissionGrants: [{ permissionKey: "people.view", scope: "organisation" }],
    operationalPolicy: policy,
  });
});

test("rejects protected roles, incomplete policy, and invalid scoped grants", () => {
  expect(createRoleInput({
    key: "super_admin",
    name: "No",
    permissionGrants: [],
    operationalPolicy: policy,
  })).toBeUndefined();
  expect(createRoleInput({
    key: "people_lead",
    name: "People Lead",
    permissionGrants: [{ permissionKey: "people.view", scope: "office" }],
    operationalPolicy: { ...policy, wfhAllowed: undefined },
  })).toBeUndefined();
});

test("accepts portable collaboration scopes with explicit targets", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const workstreamId = "22222222-2222-4222-8222-222222222222";
  const groupId = "33333333-3333-4333-8333-333333333333";
  expect(createRoleInput({
    key: "delivery_lead",
    name: "Delivery Lead",
    permissionGrants: [
      { permissionKey: "clients.view", scope: "client", clientId },
      { permissionKey: "workstreams.view", scope: "client_workstream", clientWorkstreamId: workstreamId },
      { permissionKey: "groups.view", scope: "group", groupId },
      { permissionKey: "tasks.review", scope: "assigned_work" },
    ],
    operationalPolicy: policy,
  })).toMatchObject({ key: "delivery_lead", name: "Delivery Lead" });
});

test("role updates require a positive safe expected revision", () => {
  const role = {
    key: "people_lead",
    name: "People Lead",
    permissionGrants: [{ permissionKey: "people.view", scope: "organisation" }],
    operationalPolicy: policy,
  };
  expect(updateRoleInput({ ...role, expectedRevision: 1 })).toMatchObject({ expectedRevision: 1 });
  for (const expectedRevision of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    expect(updateRoleInput({ ...role, expectedRevision })).toBeUndefined();
  }
});
