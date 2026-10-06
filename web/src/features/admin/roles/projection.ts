import type {
  PermissionCatalogueEntry,
  RoleOperationalPolicy,
  RolePermissionGrant,
  RolePermissionScope,
  RolePermissionsEditorProps,
  RoleRecord,
  RoleScopeTargetReads,
  RoleTargetOption,
  RoleTargetReadState,
  RoleTargetScope,
} from "./contracts";

interface ReadIssue {
  message: string;
}

interface CollectionInput {
  result: unknown;
  issue?: ReadIssue | null;
}

export interface RoleTargetReadInput extends CollectionInput {
  resource: string;
  rows: unknown;
}

export interface RolePermissionsProjectionInput {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  roles: CollectionInput;
  permissions: CollectionInput;
  targetReads: Readonly<Record<RoleTargetScope, RoleTargetReadInput>>;
  formatError: RolePermissionsEditorProps["formatError"];
  onCreate: RolePermissionsEditorProps["onCreate"];
  onUpdate: RolePermissionsEditorProps["onUpdate"];
}

const scopes: readonly RolePermissionScope[] = [
  "organisation", "own_record", "office", "organisation_department", "client",
  "client_workstream", "group", "assigned_work",
];
const policyKeys: readonly (keyof RoleOperationalPolicy)[] = [
  "workEnabled", "canReceiveAssignments", "attendanceRequired", "wfhAllowed",
  "canWorkWithoutAttendance", "payrollApplicable", "payrollAttendanceContributes",
  "payrollOvertimeApplicable",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectGrant(value: unknown): RolePermissionGrant | null {
  if (!isRecord(value) || typeof value.permissionKey !== "string" ||
      !scopes.includes(value.scope as RolePermissionScope)) return null;

  const targetKeys = ["officeId", "organisationDepartmentId", "clientId", "clientWorkstreamId", "groupId"] as const;
  const grant: Record<string, string> = {
    permissionKey: value.permissionKey,
    scope: value.scope as string,
  };
  for (const key of targetKeys) {
    const target = value[key];
    if (target === null || target === undefined || target === "") continue;
    if (typeof target !== "string") return null;
    grant[key] = target;
  }
  return grant as unknown as RolePermissionGrant;
}

function projectRole(value: unknown): RoleRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.key !== "string" || typeof value.name !== "string" ||
      !Number.isSafeInteger(value.revision) || typeof value.isProtected !== "boolean" ||
      !(value.archivedAt === null || typeof value.archivedAt === "string") ||
      !isRecord(value.operationalPolicy) || !Array.isArray(value.permissionGrants)) return null;

  const operationalPolicy = {} as RoleOperationalPolicy;
  for (const key of policyKeys) {
    if (typeof value.operationalPolicy[key] !== "boolean") return null;
    operationalPolicy[key] = value.operationalPolicy[key] as boolean;
  }
  const permissionGrants = value.permissionGrants.map(projectGrant);
  if (permissionGrants.some((grant) => grant === null)) return null;

  return {
    id: value.id,
    key: value.key,
    name: value.name,
    revision: value.revision as number,
    isProtected: value.isProtected,
    archivedAt: value.archivedAt,
    operationalPolicy,
    permissionGrants: permissionGrants as RolePermissionGrant[],
  };
}

function projectPermission(value: unknown): PermissionCatalogueEntry | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.module !== "string" ||
      typeof value.description !== "string" || !Array.isArray(value.allowedScopes) ||
      value.allowedScopes.some((scope) => !scopes.includes(scope as RolePermissionScope))) return null;
  return {
    key: value.key,
    module: value.module,
    description: value.description,
    allowedScopes: value.allowedScopes as RolePermissionScope[],
  };
}

function collectionRows<T>(result: unknown, key: string, project: (value: unknown) => T | null): T[] | null {
  if (!isRecord(result) || !Array.isArray(result[key])) return null;
  const rows = result[key].map(project);
  return rows.some((row) => row === null) ? null : rows as T[];
}

function readError(result: unknown): string | null {
  return isRecord(result) && typeof result.readError === "string" ? result.readError : null;
}

function projectTargetRead(input: RoleTargetReadInput): RoleTargetReadState {
  const error = readError(input.result);
  if (isRecord(input.result) && input.result.readState === "not-requested") {
    return { status: "unavailable", options: [], message: `${input.resource} were not requested for this access.` };
  }
  if (error || input.issue) {
    const message = input.issue?.message || `Could not load ${input.resource}.`;
    return error === "PREREQUISITE_PERMISSION_REQUIRED"
      ? { status: "unavailable", options: [], message }
      : { status: "error", options: [], message };
  }
  if (!Array.isArray(input.rows)) {
    return { status: "error", options: [], message: `Could not read ${input.resource}. Refresh Admin to try again.` };
  }

  if (input.rows.some((row) => !isRecord(row) || typeof row.id !== "string" || row.id.length === 0)) {
    return { status: "error", options: [], message: `Could not read ${input.resource}. Refresh Admin to try again.` };
  }
  const rows = input.rows as Record<string, unknown>[];
  const options = rows.map((row): RoleTargetOption => ({
    id: row.id as string,
    name: typeof row.name === "string" && row.name ? row.name : row.id as string,
  }));
  return { status: "ready", options };
}

/** Project only the role editor's purpose-limited role, catalogue, and selector DTOs. */
export function projectRolePermissionsEditorProps(
  input: RolePermissionsProjectionInput,
): RolePermissionsEditorProps {
  const errors: string[] = [];
  let roles: RoleRecord[] = [];
  let permissions: PermissionCatalogueEntry[] = [];

  if (input.roles.issue) errors.push(input.roles.issue.message);
  else {
    const projected = collectionRows(input.roles.result, "roles", projectRole);
    roles = projected || [];
    if (projected === null) {
      errors.push("The roles response could not be read. Refresh Admin to try again.");
    }
  }
  if (input.permissions.issue) errors.push(input.permissions.issue.message);
  else {
    const projected = collectionRows(input.permissions.result, "permissions", projectPermission);
    permissions = projected || [];
    if (projected === null) {
      errors.push("The role permission catalogue response could not be read. Refresh Admin to try again.");
    }
  }

  const targetReads = Object.fromEntries(
    (Object.keys(input.targetReads) as RoleTargetScope[]).map((scope) => [scope, projectTargetRead(input.targetReads[scope])]),
  ) as RoleScopeTargetReads;

  return {
    canView: input.canView,
    canCreate: input.canCreate,
    canEdit: input.canEdit,
    readState: errors.length ? { status: "error", messages: errors } : { status: "ready" },
    roles,
    permissions,
    targetReads,
    formatError: input.formatError,
    onCreate: input.onCreate,
    onUpdate: input.onUpdate,
  };
}
