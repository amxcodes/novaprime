import type {
  PermissionCatalogueEntry,
  RolePermissionGrant,
  RolePermissionScope,
  RoleScopeTargetReads,
  RoleTargetScope,
} from "./contracts";

export const ROLE_SCOPE_LABELS: Readonly<Record<RolePermissionScope, string>> = {
  organisation: "Organisation",
  own_record: "Own record",
  office: "Office",
  organisation_department: "Department",
  client: "Client",
  client_workstream: "Client workstream",
  group: "Group",
  assigned_work: "Assigned work",
};

const targetScopeByScope: Partial<Record<RolePermissionScope, RoleTargetScope>> = {
  office: "office",
  organisation_department: "organisation_department",
  client: "client",
  client_workstream: "client_workstream",
  group: "group",
};

export interface RoleScopeChoice {
  value: string;
  label: string;
  disabled: boolean;
  unavailableReason?: string;
}

export function roleScopeChoices(
  permission: PermissionCatalogueEntry,
  targetReads: RoleScopeTargetReads,
  savedScope?: string,
): RoleScopeChoice[] {
  const allowedScopes: readonly string[] = permission.allowedScopes.length
    ? permission.allowedScopes
    : ["organisation"];
  const scopes = [...allowedScopes];
  if (savedScope && !scopes.includes(savedScope)) scopes.push(savedScope);

  return scopes.map((scope) => {
    const targetScope = targetScopeByScope[scope as RolePermissionScope];
    const targetRead = targetScope ? targetReads[targetScope] : undefined;
    let unavailableReason: string | undefined;
    if (targetRead && targetRead.status !== "ready") {
      unavailableReason = targetRead.message || `${ROLE_SCOPE_LABELS[scope as RolePermissionScope]} targets are unavailable.`;
    } else if (targetRead && targetRead.options.length === 0) {
      unavailableReason = `No ${ROLE_SCOPE_LABELS[scope as RolePermissionScope].toLowerCase()} targets are available.`;
    } else if (savedScope === scope && !allowedScopes.includes(scope)) {
      unavailableReason = "This saved scope is absent from the current permission catalogue. It is kept unchanged for review.";
    }

    return {
      value: scope,
      label: ROLE_SCOPE_LABELS[scope as RolePermissionScope]
        ? `${ROLE_SCOPE_LABELS[scope as RolePermissionScope]}${unavailableReason ? " — unavailable" : ""}`
        : `${scope} — saved value`,
      disabled: Boolean(unavailableReason),
      unavailableReason,
    };
  });
}

export function assignableRoleScopes(permission: PermissionCatalogueEntry, targetReads: RoleScopeTargetReads): string[] {
  return roleScopeChoices(permission, targetReads).filter((choice) => !choice.disabled).map((choice) => choice.value);
}

export function roleGrantTargetId(grant: Partial<RolePermissionGrant> | null | undefined): string {
  if (!grant) return "";
  return grant.officeId || grant.organisationDepartmentId || grant.clientId ||
    grant.clientWorkstreamId || grant.groupId || "";
}

export function roleGrantTargetOptions(
  options: ReadonlyArray<{ id: string; name: string }>,
  savedTargetId: string,
): Array<{ value: string; label: string }> {
  const choices = options.map((option) => ({ value: option.id, label: option.name }));
  if (savedTargetId && !options.some((option) => option.id === savedTargetId)) {
    choices.push({ value: savedTargetId, label: "Previously saved target — unavailable" });
  }
  return choices;
}

export function rolePermissionModules(permissions: ReadonlyArray<PermissionCatalogueEntry>): Array<{
  name: string;
  permissions: PermissionCatalogueEntry[];
}> {
  const modules = new Map<string, PermissionCatalogueEntry[]>();
  for (const permission of permissions) {
    const name = permission.module?.trim() || "Other permissions";
    const rows = modules.get(name) || [];
    rows.push(permission);
    modules.set(name, rows);
  }
  return [...modules].map(([name, rows]) => ({ name, permissions: rows }));
}
