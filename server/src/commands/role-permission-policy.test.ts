import { expect, test } from "bun:test";
import { customerRolePermissionGrantsAreValid } from "./role-permission-policy";

const people = {
  key: "people.view",
  allowed_scopes: ["organisation"],
  customer_role_assignable: true,
};
const payroll = {
  key: "payroll.view",
  allowed_scopes: ["organisation"],
  customer_role_assignable: false,
};
const savedPayroll = [{ permissionKey: "payroll.view", scope: "organisation" }];

test("customer roles can receive active permissions but cannot newly receive future permissions", () => {
  expect(customerRolePermissionGrantsAreValid([], [
    { permissionKey: "people.view", scope: "organisation" },
  ], [people, payroll])).toBe(true);
  expect(customerRolePermissionGrantsAreValid([], savedPayroll, [people, payroll])).toBe(false);
});

test("editing a legacy role preserves an unavailable grant exactly while accepting unrelated changes", () => {
  expect(customerRolePermissionGrantsAreValid(savedPayroll, savedPayroll, [people, payroll])).toBe(true);
  expect(customerRolePermissionGrantsAreValid(savedPayroll, [
    ...savedPayroll,
    { permissionKey: "people.view", scope: "organisation" },
  ], [people, payroll])).toBe(true);
  expect(customerRolePermissionGrantsAreValid(savedPayroll, [], [people, payroll])).toBe(false);
  expect(customerRolePermissionGrantsAreValid(savedPayroll, [
    { permissionKey: "payroll.view", scope: "own_record" },
  ], [people, payroll])).toBe(false);
  expect(customerRolePermissionGrantsAreValid(savedPayroll, [
    { permissionKey: "payroll.view", scope: "organisation", officeId: "office-1" },
  ], [people, payroll])).toBe(false);
  expect(customerRolePermissionGrantsAreValid([], savedPayroll, [people, payroll])).toBe(false);
});

test("catalogue and scope validation remain part of the customer role contract", () => {
  expect(customerRolePermissionGrantsAreValid([], [
    { permissionKey: "unknown.permission", scope: "organisation" },
  ], [people, payroll])).toBe(false);
  expect(customerRolePermissionGrantsAreValid([], [
    { permissionKey: "people.view", scope: "office" },
  ], [people, payroll])).toBe(false);
  expect(customerRolePermissionGrantsAreValid(savedPayroll, savedPayroll, [people])).toBe(false);
});
