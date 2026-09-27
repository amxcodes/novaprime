import { expect, test } from "bun:test";
import {
  adminReadIssue,
  adminPermissionNoticeMessage,
  canShowAdminNavigation,
  canShowInviteNavigation,
  canViewAuthHandoffs,
  hasAnyPermissionGrant,
  hasPermissionGrant,
  readOrError,
} from "../web/admin-read-state.js";

test("admin reads distinguish a permission denial from an empty result", () => {
  expect(adminReadIssue({ requests: [] }, "pending leave requests")).toBeUndefined();
  expect(adminReadIssue({ requests: [], readError: "PERMISSION_DENIED" }, "pending leave requests")).toEqual({
    kind: "unavailable",
    message: "You do not have permission to view pending leave requests.",
  });
});

test("admin reads report a retryable failure without claiming the resource is empty", () => {
  expect(adminReadIssue({ tasks: [], readError: "REQUEST_FAILED" }, "tasks")).toEqual({
    kind: "unavailable",
    message: "Could not load tasks. Refresh the page to try again.",
  });
});

test("permission-load notice gives unverified users the actual next step", () => {
  expect(adminPermissionNoticeMessage({ readError: "PERMISSION_DENIED" }, { emailVerified: false })).toBe(
    "Your email is still unverified, so role permissions are unavailable. Request a verification link in Settings; if email is not available, use the secure handoff there.",
  );
  expect(adminPermissionNoticeMessage({ readError: "REQUEST_FAILED" }, { emailVerified: true })).toBe(
    "Admin links are hidden because your permissions could not be checked. Refresh to try again.",
  );
  expect(adminPermissionNoticeMessage({ grants: [] }, { emailVerified: false })).toBeUndefined();
});

test("optional reads preserve successes and mark failed reads without mutating the fallback", async () => {
  const fallback = { requests: [] };
  expect(await readOrError(Promise.resolve({ requests: [{ id: "1" }] }), fallback)).toEqual({ requests: [{ id: "1" }] });
  expect(await readOrError(Promise.reject({ code: "PERMISSION_DENIED" }), fallback)).toEqual({
    requests: [], readError: "PERMISSION_DENIED",
  });
  expect(fallback).toEqual({ requests: [] });
});

test("permission UI hints fail closed and match only the actor's applicable grant scope", () => {
  const grants = {
    actorPersonId: "actor-1",
    grants: [
      { permissionKey: "roles.create", scope: "organisation" },
      { permissionKey: "people.offboard", scope: "office", officeId: "office-1" },
      { permissionKey: "people.edit", scope: "own_record" },
    ],
  };
  expect(hasPermissionGrant(grants, "roles.create")).toBe(true);
  expect(hasPermissionGrant(grants, "people.offboard", { officeId: "office-1" })).toBe(true);
  expect(hasPermissionGrant(grants, "people.offboard", { officeId: "office-2" })).toBe(false);
  expect(hasPermissionGrant(grants, "people.edit", { personId: "actor-1" })).toBe(true);
  expect(hasPermissionGrant(grants, "people.edit", { personId: "person-2" })).toBe(false);
  expect(hasPermissionGrant({ grants: [], readError: "REQUEST_FAILED" }, "roles.create")).toBe(false);
  expect(hasPermissionGrant(undefined, "roles.create")).toBe(false);
});

test("management navigation follows grants while self-service pages do not depend on admin access", () => {
  const employee = {
    actorPersonId: "worker-1",
    isSuperAdmin: false,
    grants: [
      { permissionKey: "tasks.view", scope: "assigned_work" },
      { permissionKey: "attendance.view", scope: "own_record" },
    ],
  };
  expect(canShowAdminNavigation(employee)).toBe(false);
  expect(canShowInviteNavigation(employee)).toBe(false);
  expect(canViewAuthHandoffs(employee)).toBe(false);
  expect(hasAnyPermissionGrant(employee, ["tasks.view"])).toBe(true);
  expect(canShowAdminNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "availability.calendar.view", scope: "office", officeId: "office-1" }],
  })).toBe(true);
  expect(canShowInviteNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "people.invite", scope: "organisation" }],
  })).toBe(true);
  expect(canViewAuthHandoffs({
    isSuperAdmin: false,
    grants: [{ permissionKey: "auth.manual_recovery", scope: "organisation" }],
  })).toBe(true);
  expect(canShowAdminNavigation({ grants: [], readError: "REQUEST_FAILED" })).toBe(false);
  expect(canShowAdminNavigation({ isSuperAdmin: true, grants: [] })).toBe(true);
});
