import { describe, expect, it } from "bun:test";
import type { RolePermissionsProjectionInput } from "./projection";
import { projectRolePermissionsEditorProps } from "./projection";

const policy = {
  workEnabled: true,
  canReceiveAssignments: false,
  attendanceRequired: false,
  wfhAllowed: true,
  canWorkWithoutAttendance: false,
  payrollApplicable: false,
  payrollAttendanceContributes: false,
  payrollOvertimeApplicable: false,
};

function baseInput(overrides: Partial<RolePermissionsProjectionInput> = {}): RolePermissionsProjectionInput {
  return {
    canView: true,
    canCreate: false,
    canEdit: false,
    roles: { result: { roles: [{
      id: "role-1",
      key: "people_partner",
      name: "People Partner",
      revision: 4,
      isProtected: false,
      archivedAt: null,
      createdAt: "private-created-time",
      privateNote: "private role field",
      operationalPolicy: policy,
      permissionGrants: [{
        permissionKey: "people.view",
        scope: "office",
        officeId: "office-7",
        privateExtra: "not projected",
        clientId: null,
      }],
    }] } },
    permissions: { result: { permissions: [{
      key: "people.view",
      module: "People",
      description: "View people records.",
      allowedScopes: ["organisation", "office"],
      customerRoleAssignable: true,
      internalExtra: "not projected",
    }] } },
    targetReads: {
      office: { result: { offices: [{ id: "office-7", name: "Central", extra: "private" }] }, rows: [{ id: "office-7", name: "Central", extra: "private" }], resource: "office scope targets" },
      organisation_department: { result: { readError: "PREREQUISITE_PERMISSION_REQUIRED", requiredPermission: "organisation.settings.manage" }, issue: { message: "Department list requires settings access." }, rows: [], resource: "department scope targets" },
      client: { result: { readState: "not-requested" }, rows: [], resource: "client scope targets" },
      client_workstream: { result: { readError: "REQUEST_FAILED" }, issue: { message: "Work context could not load." }, rows: [], resource: "client workstream scope targets" },
      group: { result: { groups: [] }, rows: [], resource: "group scope targets" },
    },
    formatError: () => undefined,
    onSearch: async () => ({ roles: [] }),
    onCreate() {},
    onUpdate() {},
    ...overrides,
  };
}

describe("role permissions feature projection", () => {
  it("projects disabled future permissions as explicit unavailable catalogue entries", () => {
    const props = projectRolePermissionsEditorProps(baseInput({
      permissions: { result: { permissions: [{
        key: "payroll.view",
        module: "Payroll",
        description: "View future payroll records.",
        allowedScopes: ["organisation"],
        customerRoleAssignable: false,
      }] } },
    }));
    expect(props.readState).toEqual({ status: "ready" });
    expect(props.permissions).toEqual([{
      key: "payroll.view",
      module: "Payroll",
      description: "View future payroll records.",
      allowedScopes: ["organisation"],
      customerRoleAssignable: false,
    }]);
  });

  it("projects only editor fields and strips unrelated role, grant, catalogue, and target data", () => {
    const props = projectRolePermissionsEditorProps(baseInput());
    expect(props.readState).toEqual({ status: "ready" });
    expect(props.roles).toEqual([{
      id: "role-1",
      key: "people_partner",
      name: "People Partner",
      revision: 4,
      isProtected: false,
      archivedAt: null,
      operationalPolicy: policy,
      permissionGrants: [{ permissionKey: "people.view", scope: "office", officeId: "office-7" }],
    }]);
    expect(props.permissions).toEqual([{
      key: "people.view",
      module: "People",
      description: "View people records.",
      allowedScopes: ["organisation", "office"],
      customerRoleAssignable: true,
    }]);
    expect(props.targetReads.office).toEqual({ status: "ready", options: [{ id: "office-7", name: "Central" }] });
    expect(JSON.stringify(props)).not.toMatch(/private-created-time|private role field|not projected|private"/);
  });

  it("preserves target reads independently and distinguishes unavailable from error and ready-empty", () => {
    const { targetReads } = projectRolePermissionsEditorProps(baseInput());
    expect(targetReads.office).toEqual({ status: "ready", options: [{ id: "office-7", name: "Central" }] });
    expect(targetReads.organisation_department).toEqual({
      status: "unavailable", options: [], message: "Department list requires settings access.",
    });
    expect(targetReads.client).toEqual({
      status: "unavailable", options: [], message: "client scope targets were not requested for this access.",
    });
    expect(targetReads.client_workstream).toEqual({ status: "error", options: [], message: "Work context could not load." });
    expect(targetReads.group).toEqual({ status: "ready", options: [] });
  });

  it("exposes only a bounded ID/name projection for role-view-protected remote targets", async () => {
    const calls: unknown[] = [];
    const props = projectRolePermissionsEditorProps(baseInput({
      onSearchTargets: async (scope, query) => {
        calls.push([scope, query]);
        return [
          { id: "client-1", name: "Northstar", internal: "hidden" },
          { id: "client-2", name: "Juniper", internal: "hidden" },
        ] as never;
      },
    }));
    expect(await props.onSearchTargets?.("client", "North")).toEqual([
      { id: "client-1", name: "Northstar" },
      { id: "client-2", name: "Juniper" },
    ]);
    expect(calls).toEqual([["client", "North"]]);
  });

  it("validates and minimizes role search results returned by the authorized server query", async () => {
    const props = projectRolePermissionsEditorProps(baseInput({
      onSearch: async () => ({ roles: [{
        id: "role-2",
        key: "project_lead",
        name: "Project Lead",
        revision: 2,
        isProtected: false,
        archivedAt: null,
        operationalPolicy: policy,
        permissionGrants: [],
        privateNote: "not projected",
      }] }),
    }));

    expect(await props.onSearch("project")).toEqual([{
      id: "role-2",
      key: "project_lead",
      name: "Project Lead",
      revision: 2,
      isProtected: false,
      archivedAt: null,
      operationalPolicy: policy,
      permissionGrants: [],
    }]);
    const malformedSearch = projectRolePermissionsEditorProps(baseInput({
      onSearch: async () => ({ roles: [{ id: "role-bad", key: "bad" }] }),
    }));
    await expect(malformedSearch.onSearch("bad")).rejects.toThrow("role search response could not be read");
  });

  it("keeps role and catalogue read failures distinct and fails closed for malformed rows", () => {
    const readFailures = projectRolePermissionsEditorProps(baseInput({
      roles: { result: { roles: [] }, issue: { message: "Roles were denied." } },
      permissions: { result: { permissions: [] }, issue: { message: "The permission catalogue failed." } },
    }));
    expect(readFailures.readState).toEqual({
      status: "error", messages: ["Roles were denied.", "The permission catalogue failed."],
    });
    expect(readFailures.roles).toEqual([]);
    expect(readFailures.permissions).toEqual([]);

    const malformedRole = projectRolePermissionsEditorProps(baseInput({
      roles: { result: { roles: [{ id: "role-bad", key: "bad" }] } },
    }));
    expect(malformedRole.readState).toEqual({
      status: "error", messages: ["The roles response could not be read. Refresh Admin to try again."],
    });
    expect(malformedRole.roles).toEqual([]);

    const malformedCatalogue = projectRolePermissionsEditorProps(baseInput({
      permissions: { result: { permissions: [{ key: "people.view", allowedScopes: ["bogus"] }] } },
    }));
    expect(malformedCatalogue.readState.status).toBe("error");
    expect(malformedCatalogue.permissions).toEqual([]);

    const missingAssignability = projectRolePermissionsEditorProps(baseInput({
      permissions: { result: { permissions: [{
        key: "payroll.view", module: "Payroll", description: "Future payroll permission.", allowedScopes: ["organisation"],
      }] } },
    }));
    expect(missingAssignability.readState.status).toBe("error");
    expect(missingAssignability.permissions).toEqual([]);

    const malformedTargets = projectRolePermissionsEditorProps(baseInput({
      targetReads: {
        ...baseInput().targetReads,
        office: {
          result: { offices: [{ id: 7, name: "Invalid target" }] },
          rows: [{ id: 7, name: "Invalid target" }],
          resource: "office scope targets",
        },
      },
    }));
    expect(malformedTargets.targetReads.office).toEqual({
      status: "error", options: [], message: "Could not read office scope targets. Refresh Admin to try again.",
    });
  });
});
