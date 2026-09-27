import { expect, test } from "bun:test";
import {
  collectRolePermissionGrants,
  groupRolePermissionGrants,
  leastPrivilegedRoleScope,
  rolePresetDraft,
  rolePresets,
  uniqueRoleKey,
} from "../web/role-grants.js";

test("role permission editor groups and round-trips multiple grants for one permission", () => {
  const saved = [
    { permissionKey: "people.view", scope: "office", officeId: "office-a" },
    { permissionKey: "people.view", scope: "office", officeId: "office-b" },
    { permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: "dept-a" },
  ];
  const grouped = groupRolePermissionGrants(saved);
  const result = collectRolePermissionGrants([{
    permissionKey: "people.view",
    enabled: true,
    grants: grouped.get("people.view").map((grant) => ({
      scope: grant.scope,
      targetId: grant.officeId || grant.organisationDepartmentId,
    })),
  }]);
  expect(result).toEqual({ grants: saved });
});

test("role permission serializer ignores disabled rows and rejects incomplete or duplicate grants", () => {
  expect(collectRolePermissionGrants([
    { permissionKey: "tasks.create", enabled: false, grants: [{ scope: "organisation" }] },
  ])).toEqual({ grants: [] });
  expect(collectRolePermissionGrants([
    { permissionKey: "people.view", enabled: true, grants: [{ scope: "office", targetId: "" }] },
  ])).toEqual({ error: "ROLE_GRANT_TARGET_REQUIRED" });
  expect(collectRolePermissionGrants([
    { permissionKey: "tasks.view", enabled: true, grants: [
      { scope: "assigned_work" }, { scope: "assigned_work" },
    ] },
  ])).toEqual({ error: "ROLE_GRANT_DUPLICATE" });
});

test("new role grants default to the narrowest supported scope", () => {
  expect(leastPrivilegedRoleScope(["organisation", "office", "organisation_department"])).toBe("organisation_department");
  expect(leastPrivilegedRoleScope(["organisation", "client_workstream", "group"])).toBe("group");
  expect(leastPrivilegedRoleScope(["organisation", "assigned_work"])).toBe("assigned_work");
  expect(leastPrivilegedRoleScope(["organisation"])).toBe("organisation");
});

test("starter profiles are editable drafts with exact catalog-supported scopes", () => {
  const scopesByKey = new Map();
  for (const preset of rolePresets) {
    for (const grant of preset.grants) {
      if (!scopesByKey.has(grant.permissionKey)) scopesByKey.set(grant.permissionKey, new Set());
      scopesByKey.get(grant.permissionKey).add(grant.scope);
    }
  }
  const catalogue = [...scopesByKey].map(([key, scopes]) => ({ key, allowedScopes: [...scopes] }));
  for (const preset of rolePresets) {
    const draft = rolePresetDraft(preset.id, catalogue);
    expect(draft).toMatchObject({ id: preset.id, key: preset.key, name: preset.name });
    expect(draft.omitted).toEqual([]);
    expect(draft.grants).toEqual(preset.grants);
    expect(draft.targetGrantCount).toBe(preset.grants.filter((grant) =>
      ["office", "organisation_department", "client", "client_workstream", "group"].includes(grant.scope),
    ).length);
    expect(draft.grants.every((grant) => !("officeId" in grant || "organisationDepartmentId" in grant ||
      "clientId" in grant || "clientWorkstreamId" in grant || "groupId" in grant))).toBe(true);
  }
});

test("a starter profile omits missing permissions and unsupported scopes instead of widening them", () => {
  const draft = rolePresetDraft("hr", [
    { key: "people.view", allowedScopes: ["organisation"] },
    { key: "people.create", allowedScopes: ["organisation"] },
  ]);
  expect(draft.grants).toEqual([{ permissionKey: "people.create", scope: "organisation" }]);
  expect(draft.omitted).toContainEqual({ permissionKey: "people.view", reason: "preset_scope_unavailable" });
  expect(draft.omitted).toContainEqual({ permissionKey: "people.edit", reason: "permission_unavailable" });
  expect(rolePresetDraft("not-a-profile", [])).toBeUndefined();
});

test("admin starter does not pregrant payroll, manual recovery, public-origin, or billing authority", () => {
  const preset = rolePresets.find((item) => item.id === "admin");
  const keys = preset.grants.map((grant) => grant.permissionKey);
  expect(keys.some((key) => key.startsWith("payroll."))).toBe(false);
  expect(keys).not.toContain("auth.manual_recovery");
  expect(keys).not.toContain("organisation.public_origin.manage");
  expect(keys).not.toContain("tasks.create.billable");
  expect(keys).not.toContain("tasks.catalog.manage");
  expect(keys).not.toContain("tasks.catalog.review");
});

test("starter profiles suggest a free stable role key without overwriting an existing role", () => {
  expect(uniqueRoleKey("employee", [{ key: "employee" }, { key: "employee_2" }])).toBe("employee_3");
  expect(uniqueRoleKey("hr", [{ key: "employee" }])).toBe("hr");
});
