import {
  hasAnyPermissionGrant,
  hasPermissionGrant,
  type EffectivePermissionGrant,
  type EffectivePermissionRead,
} from "../../app-shell/permission-grants.ts";

type AdminPermissionRead = EffectivePermissionRead & { isSuperAdmin?: boolean };

interface AdminFeatureDescriptor {
  permissionKeys: readonly string[];
  scopes?: readonly string[];
  scopesByPermission?: Readonly<Record<string, readonly string[]>>;
}

const organisationScopes = Object.freeze(["organisation"]);

/** Permission-key descriptors for Admin feature discovery; server checks stay authoritative. */
export const ADMIN_FEATURES = Object.freeze({
  organisationStructure: Object.freeze({
    permissionKeys: Object.freeze(["organisation.settings.manage"]), scopes: organisationScopes,
  }),
  attendancePolicy: Object.freeze({
    permissionKeys: Object.freeze(["organisation.settings.manage"]), scopes: organisationScopes,
  }),
  availabilityConfiguration: Object.freeze({
    permissionKeys: Object.freeze([
      "availability.calendar.view", "availability.calendar.manage",
      "availability.shift.view", "availability.shift.manage",
      "availability.holiday.view", "availability.holiday.manage",
    ]), scopes: organisationScopes,
  }),
  wfhOverrides: Object.freeze({
    // Read and create are independent; the component shows each only when granted.
    permissionKeys: Object.freeze(["availability.wfh_policy.view", "availability.wfh_policy.manage"]),
    scopes: organisationScopes,
  }),
  geofence: Object.freeze({
    permissionKeys: Object.freeze(["availability.office_geofence.manage"]), scopes: organisationScopes,
  }),
  roles: Object.freeze({
    // The editor needs both the role list and the permission catalogue.
    permissionKeys: Object.freeze(["roles.view"]), scopes: organisationScopes,
  }),
  work: Object.freeze({
    permissionKeys: Object.freeze([
      "clients.create", "workstreams.create", "groups.create", "tasks.create",
      "tasks.edit", "tasks.assign", "tasks.reassign", "clients.members.manage",
    ]),
    scopesByPermission: Object.freeze({
      "clients.create": organisationScopes,
      "clients.members.manage": Object.freeze(["organisation", "client"]),
      "workstreams.create": Object.freeze(["organisation", "client"]),
      "groups.create": Object.freeze(["organisation", "client_workstream"]),
      "tasks.create": Object.freeze(["organisation", "client", "client_workstream", "group"]),
      "tasks.edit": Object.freeze(["organisation", "client", "client_workstream", "group"]),
      "tasks.assign": Object.freeze(["organisation", "client", "client_workstream", "group"]),
      "tasks.reassign": Object.freeze(["organisation", "client", "client_workstream", "group"]),
    }),
  }),
  people: Object.freeze({
    permissionKeys: Object.freeze(["people.view", "people.invite"]),
    // Admin consumes the legacy full-roster endpoint, which accepts only
    // organization-scoped people.view. Scoped viewers use the bounded People directory.
    scopes: organisationScopes,
    scopesByPermission: Object.freeze({
      "people.view": organisationScopes,
      "people.invite": organisationScopes,
    }),
  }),
  leaveReview: Object.freeze({
    permissionKeys: Object.freeze(["leave.review"]),
    // The read endpoint can include own requests, but the review command forbids self-review.
    // Keep this Admin feature limited to scopes that can produce actionable review rows.
    scopes: Object.freeze(["organisation", "office", "organisation_department"]),
  }),
  wfhReview: Object.freeze({
    permissionKeys: Object.freeze(["availability.wfh.review"]),
    scopes: Object.freeze(["organisation", "office", "organisation_department"]),
  }),
  historicalExceptions: Object.freeze({
    // Resolving an exception requires finding it through the view endpoint first.
    permissionKeys: Object.freeze(["availability.exception.view"]),
    scopes: organisationScopes,
  }),
  audit: Object.freeze({ permissionKeys: Object.freeze(["people.view"]), scopes: organisationScopes }),
  notificationDelivery: Object.freeze({
    // The bounded delivery read requires view; manage alone does not justify a GET.
    permissionKeys: Object.freeze(["notifications.delivery.view"]), scopes: organisationScopes,
  }),
} satisfies Record<string, AdminFeatureDescriptor>);

/** Office creation stores a geofence on the same command, so both grants are required. */
export function canCreateOffice(read: AdminPermissionRead | null | undefined): boolean {
  return hasPermissionGrant(read, "organisation.settings.manage") &&
    hasPermissionGrant(read, "availability.office_geofence.manage");
}

export function canShowAdminFeature(read: AdminPermissionRead | null | undefined, featureId: string): boolean {
  const feature = ADMIN_FEATURES[featureId as keyof typeof ADMIN_FEATURES];
  if (!feature || read?.readError || !Array.isArray(read?.grants)) return false;
  if (featureId === "work") return canShowWorkAdminFeature(read);
  return hasAdminFeatureGrant(read, feature);
}

/** People listing and invitation are separate capabilities with different scope rules. */
export function canViewAdminPeople(read: AdminPermissionRead | null | undefined): boolean {
  const feature = ADMIN_FEATURES.people;
  return hasAnyPermissionGrant(read, ["people.view"], feature.scopesByPermission?.["people.view"] || feature.scopes);
}

export function canInviteAdminPeople(read: AdminPermissionRead | null | undefined): boolean {
  const feature = ADMIN_FEATURES.people;
  return hasAnyPermissionGrant(read, ["people.invite"], feature.scopesByPermission?.["people.invite"] || feature.scopes);
}

/** Owner transfer is a protected platform capability, never an ordinary role grant. */
export function canShowOwnerTransfer(read: AdminPermissionRead | null | undefined): boolean {
  return read?.isSuperAdmin === true && !read.readError && Array.isArray(read.grants) &&
    canViewAdminPeople(read);
}

function canShowWorkAdminFeature(read: AdminPermissionRead): boolean {
  const grants = read.grants;
  if (!Array.isArray(grants)) return false;
  const taskScopes = ["organisation", "client", "client_workstream", "group"];
  const has = (permissionKey: string, scopes: readonly string[]) =>
    hasAnyPermissionGrant(read, [permissionKey], scopes);

  if (has("clients.create", ["organisation"]) || has("workstreams.create", ["organisation"]) ||
      has("tasks.create", ["organisation", "client", "client_workstream", "group"])) return true;

  // Client membership managers can load the server-filtered client projection
  // and use the existing membership list/add/end flows in Admin.
  if (has("clients.members.manage", ["organisation", "client"])) return true;

  // Child creation is useful only when this page can load the parent selector.
  if (grants.some((grant) => grant.permissionKey === "workstreams.create" && grant.scope === "client" && (
      hasPermissionGrant(read, "clients.view", { clientId: grant.clientId }) ||
      hasPermissionGrant(read, "workstreams.view", { clientId: grant.clientId })
  ))) return true;
  if (grants.some((grant) => grant.permissionKey === "groups.create" && (
      (grant.scope === "organisation" && hasPermissionGrant(read, "workstreams.view")) ||
      (grant.scope === "client_workstream" && hasPermissionGrant(read, "workstreams.view", {
        clientId: grant.clientId,
        clientWorkstreamId: grant.clientWorkstreamId,
      }))
  ))) return true;

  // Broad task rows back Admin edit and assignment controls. Assignment
  // candidates come from the task-scoped options endpoint, not the directory.
  const canViewTaskTarget = (grant: EffectivePermissionGrant) => {
    if (!taskScopes.includes(grant.scope)) return false;
    const target = {
      ...(grant.clientId ? { clientId: grant.clientId } : {}),
      ...(grant.clientWorkstreamId ? { clientWorkstreamId: grant.clientWorkstreamId } : {}),
      ...(grant.groupId ? { groupId: grant.groupId } : {}),
    };
    return hasPermissionGrant(read, "tasks.view", target);
  };
  return grants.some((grant) => {
    if (grant.permissionKey === "tasks.edit") return canViewTaskTarget(grant);
    if (grant.permissionKey === "tasks.assign" || grant.permissionKey === "tasks.reassign") {
      return canViewTaskTarget(grant);
    }
    return false;
  });
}

function hasAdminFeatureGrant(read: AdminPermissionRead, feature: AdminFeatureDescriptor): boolean {
  if (feature.scopesByPermission) {
    return feature.permissionKeys.some((permissionKey) => hasAnyPermissionGrant(
      read,
      [permissionKey],
      feature.scopesByPermission![permissionKey] || feature.scopes,
    ));
  }
  return hasAnyPermissionGrant(read, feature.permissionKeys, feature.scopes);
}

export interface AdminReadPlan {
  organisation: boolean;
  offices: boolean;
  departments: boolean;
  permissions: boolean;
  roles: boolean;
  people: boolean;
  audit: boolean;
  availability: boolean;
  wfhPolicies: boolean;
  leavePending: boolean;
  wfhPending: boolean;
  exceptions: boolean;
  workContext: boolean;
  work: boolean;
  tasks: boolean;
  taskCatalog: boolean;
  geofenceOptions: boolean;
  notificationDelivery: boolean;
}

/**
 * Decide which independent Admin reads are justified by effective grants.
 * This is a request-planning hint only; every endpoint still checks the actor.
 */
export function planAdminReads(read: AdminPermissionRead | null | undefined): Readonly<AdminReadPlan> {
  const none: AdminReadPlan = {
    organisation: false,
    offices: false,
    departments: false,
    permissions: false,
    roles: false,
    people: false,
    audit: false,
    availability: false,
    wfhPolicies: false,
    leavePending: false,
    wfhPending: false,
    exceptions: false,
    workContext: false,
    work: false,
    tasks: false,
    taskCatalog: false,
    geofenceOptions: false,
    notificationDelivery: false,
  };
  if (read?.readError || !Array.isArray(read?.grants)) return Object.freeze(none);
  const organisationSettings = hasPermissionGrant(read, "organisation.settings.manage");
  const rolesView = hasPermissionGrant(read, "roles.view");
  const roleEditor = rolesView && hasAnyPermissionGrant(read, ["roles.create", "roles.edit"], ["organisation"]);
  const peopleView = canViewAdminPeople(read);
  const reviewScopes = ["organisation", "office", "organisation_department"];
  // This legacy endpoint returns assignment rosters, so assigned_work-only
  // viewers must use Work/Mine's purpose-limited projection instead.
  const taskListScopes = ["organisation", "client", "client_workstream", "group"];
  const catalogKeys = ["tasks.catalog.view", "tasks.catalog.manage", "tasks.catalog.propose", "tasks.catalog.review"];
  const taskCreateScopes = ["organisation", "client", "client_workstream", "group"];
  const work = canShowWorkAdminFeature(read);

  return Object.freeze({
    organisation: organisationSettings,
    offices: organisationSettings,
    departments: organisationSettings,
    permissions: rolesView,
    roles: rolesView,
    people: peopleView,
    audit: hasPermissionGrant(read, "people.view"),
    availability: hasAnyPermissionGrant(read, [
      "availability.calendar.view", "availability.calendar.manage",
      "availability.shift.view", "availability.shift.manage",
      "availability.holiday.view", "availability.holiday.manage",
    ], ["organisation"]),
    wfhPolicies: hasPermissionGrant(read, "availability.wfh_policy.view"),
    leavePending: hasAnyPermissionGrant(read, ["leave.review"], reviewScopes),
    wfhPending: hasAnyPermissionGrant(read, ["availability.wfh.review"], reviewScopes),
    exceptions: hasPermissionGrant(read, "availability.exception.view"),
    // Work Context is also the scoped target source for the role editor.
    workContext: work || roleEditor,
    work,
    tasks: work && hasAnyPermissionGrant(read, ["tasks.view"], taskListScopes),
    // Admin only reads catalog data for the task composer. Catalog management
    // is a standalone Work setup destination and does not make Admin visible.
    taskCatalog: hasAnyPermissionGrant(read, catalogKeys, ["organisation"]) &&
      hasAnyPermissionGrant(read, ["tasks.create"], taskCreateScopes),
    geofenceOptions: hasPermissionGrant(read, "availability.office_geofence.manage"),
    notificationDelivery: hasPermissionGrant(read, "notifications.delivery.view"),
  });
}
