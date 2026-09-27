export function adminReadIssue(result, resource) {
  if (!result?.readError) return undefined;
  return {
    kind: "unavailable",
    message: result.readError === "PERMISSION_DENIED"
      ? `You do not have permission to view ${resource}.`
      : `Could not load ${resource}. Refresh the page to try again.`,
  };
}

export function adminPermissionNoticeMessage(read, user) {
  if (!read?.readError) return undefined;
  if (user?.emailVerified === false) {
    return "Your email is still unverified, so role permissions are unavailable. Request a verification link in Settings; if email is not available, use the secure handoff there.";
  }
  return "Admin links are hidden because your permissions could not be checked. Refresh to try again.";
}

export async function readOrError(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    return { ...fallback, readError: error?.code || "REQUEST_FAILED" };
  }
}

export function hasPermissionGrant(read, permissionKey, target = {}) {
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

export function hasAnyPermissionGrant(read, permissionKeys) {
  if (read?.readError || !Array.isArray(read?.grants) || !Array.isArray(permissionKeys)) return false;
  return read.grants.some((grant) => permissionKeys.includes(grant.permissionKey));
}

const adminNavigationPermissions = [
  "roles.view", "roles.create", "roles.edit", "roles.assign",
  "organisation.settings.manage",
  "people.view", "people.create", "people.edit", "people.activate",
  "people.freeze", "people.offboard", "people.invite",
  "attendance.geofence.manage", "availability.office_geofence.manage",
  "availability.shift.view", "availability.shift.manage",
  "availability.calendar.view", "availability.calendar.manage",
  "availability.holiday.view", "availability.holiday.manage",
  "availability.wfh_policy.view", "availability.wfh_policy.manage",
  "availability.wfh.review", "availability.exception.view", "availability.exception.resolve",
  "leave.review", "clients.create", "clients.edit", "workstreams.create", "workstreams.edit",
  "clients.view", "workstreams.view", "groups.create", "groups.edit", "groups.view",
  "tasks.assign", "tasks.reassign", "tasks.reviewer_manage", "tasks.catalog.view",
  "tasks.catalog.manage", "tasks.catalog.review", "workstreams.billing_policy.manage",
  "notifications.manage", "notifications.delivery.view",
];

export function canShowAdminNavigation(read) {
  return read?.isSuperAdmin === true || hasAnyPermissionGrant(read, adminNavigationPermissions);
}

export function canShowInviteNavigation(read) {
  return hasPermissionGrant(read, "people.invite");
}

export function canViewAuthHandoffs(read) {
  return hasPermissionGrant(read, "people.invite") || hasPermissionGrant(read, "auth.manual_recovery");
}
