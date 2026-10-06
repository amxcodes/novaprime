import { describe, expect, it } from "bun:test";
import {
  assignableRoleScopes,
  roleGrantTargetId,
  roleGrantTargetOptions,
  roleScopeChoices,
} from "./role-editor-model";
import type {
  PermissionCatalogueEntry,
  RoleRecord,
  RoleScopeTargetReads,
} from "./contracts";

const unavailable = (message: string) => ({ status: "unavailable" as const, options: [], message });
const ready = (options: Array<{ id: string; name: string }>) => ({ status: "ready" as const, options });

const permission = (allowedScopes: PermissionCatalogueEntry["allowedScopes"]): PermissionCatalogueEntry => ({
  key: "people.view",
  module: "People",
  description: "View people records.",
  allowedScopes,
});

const targetReads: RoleScopeTargetReads = {
  office: unavailable("Office list needs organisation.settings.manage."),
  organisation_department: unavailable("Department list needs organisation.settings.manage."),
  client: ready([{ id: "client-1", name: "Client One" }]),
  client_workstream: ready([{ id: "stream-1", name: "Stream One" }]),
  group: ready([]),
};

const roleRecord = (overrides: Partial<RoleRecord>): RoleRecord => ({
  id: "role",
  key: "custom_role",
  name: "Custom Role",
  revision: 1,
  isProtected: false,
  archivedAt: null,
  operationalPolicy: {
    workEnabled: false,
    canReceiveAssignments: false,
    attendanceRequired: false,
    wfhAllowed: false,
    canWorkWithoutAttendance: false,
    payrollApplicable: false,
    payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  },
  permissionGrants: [],
  ...overrides,
});

describe("role editor scope availability", () => {
  it("keeps non-target scopes active while disabling only unavailable target scopes", () => {
    const choices = roleScopeChoices(permission([
      "organisation", "own_record", "office", "organisation_department", "client",
    ]), targetReads);

    expect(choices.find((choice) => choice.value === "organisation")?.disabled).toBe(false);
    expect(choices.find((choice) => choice.value === "own_record")?.disabled).toBe(false);
    expect(choices.find((choice) => choice.value === "office")).toMatchObject({ disabled: true });
    expect(choices.find((choice) => choice.value === "organisation_department")).toMatchObject({ disabled: true });
    expect(choices.find((choice) => choice.value === "client")?.disabled).toBe(false);
    expect(assignableRoleScopes(permission([
      "organisation", "office", "organisation_department", "client",
    ]), targetReads)).toEqual(["organisation", "client"]);
  });

  it("enables target scopes when a separate permission-checked remote directory is available", () => {
    const choices = roleScopeChoices(permission([
      "organisation", "office", "organisation_department", "client", "client_workstream", "group",
    ]), targetReads, undefined, true);

    expect(choices.every((choice) => !choice.disabled)).toBe(true);
    expect(assignableRoleScopes(permission([
      "office", "organisation_department", "client", "client_workstream", "group",
    ]), targetReads, true)).toEqual([
      "office", "organisation_department", "client", "client_workstream", "group",
    ]);
  });

  it("disables an empty ready target list without affecting other scope categories", () => {
    const choices = roleScopeChoices(permission(["assigned_work", "group", "client_workstream"]), targetReads);

    expect(choices.find((choice) => choice.value === "assigned_work")?.disabled).toBe(false);
    expect(choices.find((choice) => choice.value === "group")).toMatchObject({ disabled: true });
    expect(choices.find((choice) => choice.value === "client_workstream")?.disabled).toBe(false);
  });

  it("keeps an unavailable saved scope visible and disabled for deliberate replacement", () => {
    const choices = roleScopeChoices(permission(["organisation"]), targetReads, "office");
    expect(choices).toContainEqual(expect.objectContaining({
      value: "office",
      label: "Office — unavailable",
      disabled: true,
    }));
    expect(choices.find((choice) => choice.value === "organisation")?.disabled).toBe(false);
  });

  it("maps exactly the target column associated with a saved grant", () => {
    expect(roleGrantTargetId({ permissionKey: "people.view", scope: "office", officeId: "office-7" })).toBe("office-7");
    expect(roleGrantTargetId({ permissionKey: "tasks.view", scope: "client_workstream", clientWorkstreamId: "stream-2" })).toBe("stream-2");
    expect(roleGrantTargetId({ permissionKey: "people.view", scope: "organisation" })).toBe("");
  });

  it("maps authorized target options and retains a saved target missing from the current list", () => {
    expect(roleGrantTargetOptions([
      { id: "client-1", name: "Client One" },
      { id: "client-2", name: "Client Two" },
    ], "client-1")).toEqual([
      { value: "client-1", label: "Client One" },
      { value: "client-2", label: "Client Two" },
    ]);

    expect(roleGrantTargetOptions([{ id: "client-1", name: "Client One" }], "client-removed")).toEqual([
      { value: "client-1", label: "Client One" },
      { value: "client-removed", label: "Previously saved target — unavailable" },
    ]);
    expect(roleGrantTargetOptions([], "client-removed")).toEqual([
      { value: "client-removed", label: "Previously saved target — unavailable" },
    ]);
  });
});
