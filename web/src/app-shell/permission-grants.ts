/** Effective grants projected by the server for the active actor. */
export interface EffectivePermissionGrant {
  permissionKey: string;
  scope: string;
  selfApplicable?: boolean;
  officeId?: string | null;
  organisationDepartmentId?: string | null;
  clientId?: string | null;
  clientWorkstreamId?: string | null;
  groupId?: string | null;
}

export interface EffectivePermissionRead {
  readError?: string | null;
  actorPersonId?: string | null;
  grants?: readonly EffectivePermissionGrant[] | null;
}

export interface PermissionTarget {
  personId?: string | null;
  officeId?: string | null;
  organisationDepartmentId?: string | null;
  clientId?: string | null;
  clientWorkstreamId?: string | null;
  groupId?: string | null;
  assignedWork?: boolean;
}

/**
 * Match the server-projected effective grant to a resource target.
 * This is a client discovery/read-planning hint; protected requests remain
 * authorized by the server.
 */
export function hasPermissionGrant(
  read: EffectivePermissionRead | null | undefined,
  permissionKey: string,
  target: PermissionTarget = {},
): boolean {
  if (read?.readError || !Array.isArray(read?.grants)) return false;
  return read.grants.some((grant) => grant.permissionKey === permissionKey && (
    grant.scope === "organisation" ||
    (grant.scope === "own_record" && target.personId === read.actorPersonId) ||
    (grant.scope === "office" && target.officeId === grant.officeId) ||
    (grant.scope === "organisation_department" && target.organisationDepartmentId === grant.organisationDepartmentId) ||
    (grant.scope === "client" && target.clientId === grant.clientId) ||
    (grant.scope === "client_workstream" && target.clientWorkstreamId === grant.clientWorkstreamId) ||
    (grant.scope === "group" && target.groupId === grant.groupId) ||
    (grant.scope === "assigned_work" && target.assignedWork === true)
  ));
}

export function hasAnyPermissionGrant(
  read: EffectivePermissionRead | null | undefined,
  permissionKeys: readonly string[] | null | undefined,
  allowedScopes?: readonly string[] | null,
): boolean {
  if (read?.readError || !Array.isArray(read?.grants) || !Array.isArray(permissionKeys)) return false;
  return read.grants.some((grant) => permissionKeys.includes(grant.permissionKey) &&
    (!Array.isArray(allowedScopes) || allowedScopes.includes(grant.scope)));
}
