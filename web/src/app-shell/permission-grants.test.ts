import { describe, expect, it } from "bun:test";
import { hasAnyPermissionGrant, hasPermissionGrant } from "./permission-grants";
import {
  hasAnyPermissionGrant as legacyHasAnyPermissionGrant,
  hasPermissionGrant as legacyHasPermissionGrant,
} from "../../admin-read-state.js";

describe("effective permission grant matching", () => {
  it("keeps legacy route imports bound to the shared app-shell predicates", () => {
    expect(legacyHasPermissionGrant).toBe(hasPermissionGrant);
    expect(legacyHasAnyPermissionGrant).toBe(hasAnyPermissionGrant);
  });

  it("preserves organization, actor, and exact target-scope matching", () => {
    const read = {
      actorPersonId: "person-1",
      grants: [
        { permissionKey: "org", scope: "organisation" },
        { permissionKey: "self", scope: "own_record" },
        { permissionKey: "office", scope: "office", officeId: "office-1" },
        { permissionKey: "department", scope: "organisation_department", organisationDepartmentId: "dept-1" },
        { permissionKey: "client", scope: "client", clientId: "client-1" },
        { permissionKey: "workstream", scope: "client_workstream", clientWorkstreamId: "workstream-1" },
        { permissionKey: "group", scope: "group", groupId: "group-1" },
        { permissionKey: "assigned", scope: "assigned_work" },
      ],
    };
    expect(hasPermissionGrant(read, "org")).toBe(true);
    expect(hasPermissionGrant(read, "self", { personId: "person-1" })).toBe(true);
    expect(hasPermissionGrant(read, "self", { personId: "person-2" })).toBe(false);
    expect(hasPermissionGrant(read, "office", { officeId: "office-1" })).toBe(true);
    expect(hasPermissionGrant(read, "office", { officeId: "office-2" })).toBe(false);
    expect(hasPermissionGrant(read, "department", { organisationDepartmentId: "dept-1" })).toBe(true);
    expect(hasPermissionGrant(read, "client", { clientId: "client-1" })).toBe(true);
    expect(hasPermissionGrant(read, "workstream", { clientWorkstreamId: "workstream-1" })).toBe(true);
    expect(hasPermissionGrant(read, "group", { groupId: "group-1" })).toBe(true);
    expect(hasPermissionGrant(read, "assigned", { assignedWork: true })).toBe(true);
  });

  it("fails closed for errors, malformed reads, and unrequested scopes", () => {
    expect(hasPermissionGrant({ readError: "DENIED", grants: [{ permissionKey: "x", scope: "organisation" }] }, "x")).toBe(false);
    expect(hasPermissionGrant({ grants: null }, "x")).toBe(false);
    expect(hasPermissionGrant({ grants: [{ permissionKey: "x", scope: "office", officeId: "office-1" }] }, "x", { officeId: "office-2" })).toBe(false);
    expect(hasAnyPermissionGrant({ grants: [{ permissionKey: "x", scope: "office" }] }, ["x"], ["organisation"])).toBe(false);
    expect(hasAnyPermissionGrant({ grants: [{ permissionKey: "x", scope: "office" }] }, ["x"])).toBe(true);
    expect(hasAnyPermissionGrant({ grants: [{ permissionKey: "x", scope: "office" }] }, null)).toBe(false);
  });
});
