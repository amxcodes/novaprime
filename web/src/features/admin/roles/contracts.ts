export type RolePermissionScope =
  | "organisation"
  | "own_record"
  | "office"
  | "organisation_department"
  | "client"
  | "client_workstream"
  | "group"
  | "assigned_work";

export type RoleTargetScope = Extract<RolePermissionScope,
  "office" | "organisation_department" | "client" | "client_workstream" | "group">;

export interface RolePermissionGrant {
  permissionKey: string;
  scope: RolePermissionScope;
  officeId?: string;
  organisationDepartmentId?: string;
  clientId?: string;
  clientWorkstreamId?: string;
  groupId?: string;
}

export interface RoleOperationalPolicy {
  workEnabled: boolean;
  canReceiveAssignments: boolean;
  attendanceRequired: boolean;
  wfhAllowed: boolean;
  canWorkWithoutAttendance: boolean;
  payrollApplicable: boolean;
  payrollAttendanceContributes: boolean;
  payrollOvertimeApplicable: boolean;
}

export interface RoleRecord {
  id: string;
  key: string;
  name: string;
  revision: number;
  isProtected: boolean;
  archivedAt: string | null;
  operationalPolicy: RoleOperationalPolicy;
  permissionGrants: ReadonlyArray<RolePermissionGrant>;
}

export interface PermissionCatalogueEntry {
  key: string;
  module: string;
  description: string;
  allowedScopes: ReadonlyArray<RolePermissionScope>;
}

export interface RoleTargetOption {
  id: string;
  name: string;
}

export interface RoleTargetReadState {
  status: "ready" | "unavailable" | "error";
  options: ReadonlyArray<RoleTargetOption>;
  message?: string;
}

export type RoleScopeTargetReads = Readonly<Record<RoleTargetScope, RoleTargetReadState>>;

export interface RoleMutationPayload {
  key: string;
  name: string;
  permissionGrants: ReadonlyArray<RolePermissionGrant>;
  operationalPolicy: RoleOperationalPolicy;
}

export interface RolePermissionsEditorProps {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  readState: { status: "ready" } | { status: "error"; messages: ReadonlyArray<string> };
  roles: ReadonlyArray<RoleRecord>;
  permissions: ReadonlyArray<PermissionCatalogueEntry>;
  targetReads: RoleScopeTargetReads;
  /** Optional narrow remote directory; every query is checked server-side with roles.view. */
  onSearchTargets?: (scope: RoleTargetScope, query: string) => Promise<ReadonlyArray<RoleTargetOption>>;
  formatError: (code: string) => string | undefined;
  onSearch: (query: string) => Promise<ReadonlyArray<RoleRecord>>;
  onCreate: (payload: RoleMutationPayload) => void | Promise<void>;
  onUpdate: (roleId: string, payload: RoleMutationPayload & { expectedRevision: number }) => void | Promise<void>;
}
