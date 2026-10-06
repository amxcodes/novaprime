export type RolePermissionGrant = Readonly<{
  permissionKey: string;
  scope: string;
  officeId?: string;
  organisationDepartmentId?: string;
  clientId?: string;
  clientWorkstreamId?: string;
  groupId?: string;
}>;

export type RoleOperationalPolicy = Readonly<{
  workEnabled: boolean;
  canReceiveAssignments: boolean;
  attendanceRequired: boolean;
  wfhAllowed: boolean;
  canWorkWithoutAttendance: boolean;
  payrollApplicable: boolean;
  payrollAttendanceContributes: boolean;
  payrollOvertimeApplicable: boolean;
}>;

export type RolePreset = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string;
  grants: readonly Readonly<{ permissionKey: string; scope: string }>[];
  operationalPolicy: RoleOperationalPolicy;
}>;

export type RolePresetDraft = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string;
  grants: readonly Readonly<{ permissionKey: string; scope: string }>[];
  operationalPolicy: RoleOperationalPolicy;
  omitted: readonly Readonly<{
    permissionKey: string;
    reason: "permission_unavailable" | "preset_scope_unavailable";
  }>[];
  targetGrantCount: number;
}>;

export declare const rolePresets: readonly RolePreset[];
export declare function rolePresetDraft(
  presetId: string,
  permissions: readonly Readonly<{ key: string; allowedScopes: readonly string[] }>[] | undefined,
): RolePresetDraft | undefined;

export declare function groupRolePermissionGrants(
  grants: readonly RolePermissionGrant[] | undefined,
): Map<string, RolePermissionGrant[]>;

export declare function leastPrivilegedRoleScope(allowedScopes: readonly string[]): string;

export declare function uniqueRoleKey(
  baseKey: string,
  roles: readonly Readonly<{ key?: string | null }>[] | undefined,
): string;

export type RolePermissionGrantDraftRow = Readonly<{
  permissionKey: string;
  enabled: boolean;
  grants: readonly Readonly<{ scope: string; targetId?: string }>[];
}>;

export type RolePermissionGrantCollection =
  | Readonly<{ grants: readonly RolePermissionGrant[] }>
  | Readonly<{ error: string }>;

export declare function collectRolePermissionGrants(
  rows: readonly RolePermissionGrantDraftRow[],
): RolePermissionGrantCollection;
