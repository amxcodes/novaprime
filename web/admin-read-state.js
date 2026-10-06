import { evaluateTodayActionCapabilities } from "./src/features/my-day/capabilities.ts";
import { planWorkReads } from "./src/features/work/read-capabilities.ts";
import { hasAnyPermissionGrant, hasPermissionGrant } from "./src/app-shell/permission-grants.ts";
import {
  ADMIN_FEATURES,
  canShowAdminFeature,
  canShowOwnerTransfer,
  canViewAdminPeople,
} from "./src/features/admin/capabilities.ts";
export { TODAY_ACTION_CAPABILITIES } from "./src/features/my-day/capabilities.ts";
export { hasAnyPermissionGrant, hasPermissionGrant } from "./src/app-shell/permission-grants.ts";

export function adminReadIssue(result, resource) {
  if (!result?.readError) return undefined;
  if (result.readError === "PREREQUISITE_PERMISSION_REQUIRED") {
    return {
      kind: "unavailable",
      message: `Cannot load ${resource}; ${result.requiredPermission || "another permission"} is required for this selector.`,
    };
  }
  return {
    kind: "unavailable",
    message: result.readError === "PERMISSION_DENIED"
      ? `You do not have permission to view ${resource}.`
      : `Could not load ${resource}. Refresh the page to try again.`,
  };
}

/** Preserve a resource's fallback shape while explaining that its read was intentionally skipped. */
export function skippedAdminRead(fallback, requiredPermission) {
  return {
    ...fallback,
    readError: "PREREQUISITE_PERMISSION_REQUIRED",
    requiredPermission,
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

export { ADMIN_FEATURES, canCreateOffice, canShowAdminFeature, planAdminReads } from "./src/features/admin/capabilities.ts";
export { canShowAvailabilityNavigation, planAvailabilityAgendaReads } from "./src/features/availability/capabilities.ts";
export {
  canShowOperationsNavigation,
  planOperationsAvailabilitySources,
  planOperationsReads,
} from "./src/features/operations/capabilities.ts";

export function canShowAdminNavigation(read) {
  if (read?.readError || !Array.isArray(read?.grants)) return false;
  // Owner Transfer also needs the separately authorized organization People
  // roster; Super Admin status alone does not make the Admin route usable.
  if (read?.isSuperAdmin === true && canShowOwnerTransfer(read)) return true;
  return Object.keys(ADMIN_FEATURES).some((featureId) => {
    if (featureId !== "people") return canShowAdminFeature(read, featureId);
    return canViewAdminPeople(read);
  });
}

export function canShowInviteNavigation(read) {
  return hasPermissionGrant(read, "people.invite");
}

export function canShowTodayNavigation(read) {
  return planMyDayReads(read).hasAny;
}

/** Plan Today controls independently; viewing attendance never grants its mutations or request modules. */
export function planTodayFeatures(read) {
  return evaluateTodayActionCapabilities(read);
}

/** Plan each My Day module from the read contract it actually consumes. */
export function planMyDayReads(read) {
  const none = {
    attendance: false,
    attendanceActionContext: false,
    assignments: false,
    timeline: false,
    leaveRequest: false,
    wfhRequest: false,
    hasAny: false,
  };
  if (read?.readError || !Array.isArray(read?.grants)) return Object.freeze(none);

  const today = planTodayFeatures(read);
  const work = planWorkReads(read);
  const modules = {
    attendance: read.grants.some((grant) =>
      grant.permissionKey === "attendance.view" && grant.selfApplicable === true,
    ),
    attendanceActionContext: ["checkIn", "checkOut", "changeMode"].some((feature) => today[feature]),
    assignments: work.assignments,
    timeline: work.timeline,
    leaveRequest: today.leaveRequest,
    wfhRequest: today.wfhRequest,
  };
  return Object.freeze({ ...modules, hasAny: Object.values(modules).some(Boolean) });
}

export function canShowWorkNavigation(read) {
  if (read?.readError || !Array.isArray(read?.grants)) return false;
  if (read?.hasOpenWorkSession === true) return true;
  return Object.entries(planWorkReads(read)).some(([feature, enabled]) =>
    feature !== "taskCatalog" && enabled,
  );
}

/** Keep reusable definitions and billing policy controls off the daily Work surface. */
export function planWorkSetupReads(read) {
  const none = { taskCatalog: false, billingPolicy: false, hasAny: false };
  if (read?.readError || !Array.isArray(read?.grants)) return Object.freeze(none);
  const taskCatalog = hasAnyPermissionGrant(read, [
    "tasks.catalog.view", "tasks.catalog.manage", "tasks.catalog.propose", "tasks.catalog.review",
  ], ["organisation"]);
  const billingPolicy = hasAnyPermissionGrant(read, ["workstreams.billing_policy.manage"], [
    "organisation", "client", "client_workstream",
  ]);
  return Object.freeze({ taskCatalog, billingPolicy, hasAny: taskCatalog || billingPolicy });
}

export function canShowWorkSetupNavigation(read) {
  return planWorkSetupReads(read).hasAny;
}

/** Creation targets may expose a group name without granting permission to browse it. */
export function canShowWorkContextGroup(group) {
  return group?.canViewGroup === true;
}

export function canShowPeopleNavigation(read) {
  return hasAnyPermissionGrant(read, ["people.view"], ["organisation", "office", "organisation_department"]);
}

export { planWorkReads } from "./src/features/work/read-capabilities.ts";

export function canViewAuthHandoffs(read) {
  return hasPermissionGrant(read, "people.invite") || hasPermissionGrant(read, "auth.manual_recovery");
}
