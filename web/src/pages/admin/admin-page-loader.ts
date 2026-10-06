import type { EffectivePermissionRead } from "../../app-shell/permission-grants.ts";
import { hasPermissionGrant } from "../../app-shell/permission-grants.ts";
import { planAdminReads } from "../../features/admin/capabilities";

type AdminRead = {
  readError?: string;
  readState?: string;
  requiredPermission?: string;
  [key: string]: unknown;
};

type AdminActorRead = EffectivePermissionRead & {
  isSuperAdmin?: boolean;
  readError?: string;
};

export interface AdminPageData {
  organisation: AdminRead;
  offices: AdminRead;
  departments: AdminRead;
  permissions: AdminRead;
  roles: AdminRead;
  /** Legacy shell slot retained without loading or exposing an unbounded roster. */
  people: AdminRead;
  /** Bounded, server-authorized People directory page used by Admin. */
  peopleDirectory: AdminRead;
  audit: AdminRead;
  availability: AdminRead;
  wfhPolicies: AdminRead;
  leavePending: AdminRead;
  wfhPending: AdminRead;
  exceptions: AdminRead;
  workContext: AdminRead;
  tasks: AdminRead;
  taskCatalog: AdminRead;
  actorGrants: AdminActorRead;
  geofenceOptions: AdminRead;
  notificationDelivery: AdminRead;
}

export interface AdminPageLoaderServices<TLifetime = unknown> {
  pageApi: (path: string, lifetime: TLifetime) => Promise<AdminRead>;
  readOrError: (promise: Promise<AdminRead>, fallback: AdminRead) => Promise<AdminRead>;
  skippedAdminRead: (fallback: AdminRead, requiredPermission: string) => AdminRead;
  isCurrentPageRequest: (lifetime: TLifetime) => boolean;
  /** Start grant-authorized view modules before the independent Admin read batch. */
  onEffectiveGrantsResolved?: (actorGrants: AdminActorRead) => unknown;
}

/**
 * Read the Admin route's independent sources from the server grant projection.
 * The app host still supplies transport and request lifetime; this page-owned
 * loader keeps read planning, dependencies, and partial states together.
 */
export async function loadAdminPageData<TLifetime>(
  lifetime: TLifetime,
  pageReady: Promise<boolean>,
  services: AdminPageLoaderServices<TLifetime>,
): Promise<AdminPageData | undefined> {
  if (!await pageReady || !services.isCurrentPageRequest(lifetime)) return undefined;

  const actorGrants = await services.readOrError(
    services.pageApi("/api/me/permission-grants", lifetime),
    { grants: [], isSuperAdmin: false, actorPersonId: null },
  ) as AdminActorRead;
  if (!services.isCurrentPageRequest(lifetime)) return undefined;

  // Feature imports are client-side view code, gated by the same effective
  // server grant projection used to plan the reads below. They intentionally
  // overlap the independent endpoint batch and are only consumed for this
  // still-current page request.
  services.onEffectiveGrantsResolved?.(actorGrants);

  const plan = planAdminReads(actorGrants);
  const read = (condition: boolean, path: string, fallback: AdminRead, permission: string) => condition
    ? services.readOrError(services.pageApi(path, lifetime), fallback)
    : Promise.resolve(services.skippedAdminRead(fallback, permission));

  const organisationSettings = hasPermissionGrant(actorGrants, "organisation.settings.manage");
  const canManageWfhPolicies = hasPermissionGrant(actorGrants, "availability.wfh_policy.manage");
  // Keep the legacy shell slot empty: peopleDirectory is the bounded page
  // source, and feature selectors use purpose-limited remote endpoints.
  const peopleCanBeNeededForChoices = canManageWfhPolicies;
  const selectorPrerequisite = organisationSettings ? "" : "organisation.settings.manage";
  const peoplePrerequisite = plan.people || !peopleCanBeNeededForChoices ? "" : "people.view";
  const rolesPrerequisite = plan.roles || !plan.people ? "" : "roles.view";

  const [organisation, offices, departments, permissions, roles, people, peopleDirectory, audit, availability, wfhPolicies,
    leavePending, wfhPending, exceptions, workContext, tasks, taskCatalog, geofenceOptions, notificationDelivery] = await Promise.all([
    read(plan.organisation, "/api/organisation", { organisation: null }, "organisation.settings.manage"),
    read(plan.offices, "/api/offices", { offices: [] }, "organisation.settings.manage"),
    read(plan.departments, "/api/organisation-departments", { departments: [] }, "organisation.settings.manage"),
    read(plan.permissions, "/api/permissions", { permissions: [] }, "roles.view"),
    read(plan.roles, "/api/roles", { roles: [] }, "roles.view"),
    Promise.resolve<AdminRead>({ people: [], readState: "not-requested" }),
    read(plan.people, "/api/people/directory?q=&limit=25", {
      people: [], limit: 25, hasMore: false, nextCursor: null,
    }, peoplePrerequisite || "people.view"),
    read(plan.audit, "/api/audit-events?limit=50", { events: [] }, "people.view at organisation scope"),
    read(plan.availability, "/api/availability/config", { shifts: [], calendars: [], holidays: [] }, "availability.calendar.view at organisation scope"),
    read(plan.wfhPolicies, "/api/availability/wfh-policies", { policies: [] }, "availability.wfh_policy.view at organisation scope"),
    read(plan.leavePending, "/api/leave/pending", { requests: [] }, "leave.review for another person's scope"),
    read(plan.wfhPending, "/api/availability/wfh/pending", { requests: [] }, "availability.wfh.review for another person's scope"),
    read(plan.exceptions, "/api/historical-exceptions", { exceptions: [] }, "availability.exception.view at organisation scope"),
    plan.workContext
      ? services.readOrError(services.pageApi("/api/work-context", lifetime), {
        clients: [], clientWorkstreams: [], organisationWorkstreams: [], taskCreationTargets: [], groups: [],
      })
      : Promise.resolve<AdminRead>({
        clients: [], clientWorkstreams: [], organisationWorkstreams: [], taskCreationTargets: [], groups: [],
      }),
    read(plan.tasks, "/api/tasks", { tasks: [] }, "tasks.view in this work scope"),
    read(plan.taskCatalog, "/api/task-catalog", {
      entries: [], proposals: [], permissions: { view: false, propose: false, manage: false, review: false },
    }, "tasks.catalog.view, propose, manage, or review"),
    read(plan.geofenceOptions, "/api/offices/geofence-options", { offices: [] }, "availability.office_geofence.manage at organisation scope"),
    read(plan.notificationDelivery, "/api/notifications/delivery?limit=50", { deliveries: [] }, "notifications.delivery.view at organisation scope"),
  ]);

  if (!services.isCurrentPageRequest(lifetime)) return undefined;

  // A permitted feature may need selectors from a separately protected read.
  if (!plan.offices && !organisationSettings && (plan.roles || plan.people || plan.availability || plan.wfhPolicies || canManageWfhPolicies || plan.workContext)) {
    offices.readError = "PREREQUISITE_PERMISSION_REQUIRED";
    offices.requiredPermission = selectorPrerequisite;
    departments.readError = "PREREQUISITE_PERMISSION_REQUIRED";
    departments.requiredPermission = selectorPrerequisite;
  }
  if (!plan.people && !peopleCanBeNeededForChoices) {
    people.readState = "not-requested";
    delete people.readError;
    delete people.requiredPermission;
  } else if (!plan.people && peopleCanBeNeededForChoices) {
    people.readError = "PREREQUISITE_PERMISSION_REQUIRED";
    people.requiredPermission = "people.view";
  }
  if (!plan.roles && plan.people) {
    roles.readError = "PREREQUISITE_PERMISSION_REQUIRED";
    roles.requiredPermission = rolesPrerequisite;
  }
  if (!plan.workContext) workContext.readState = "not-requested";
  if (!plan.taskCatalog) taskCatalog.readState = "not-requested";
  if (!plan.tasks && plan.workContext) {
    tasks.readError = "PREREQUISITE_PERMISSION_REQUIRED";
    tasks.requiredPermission = "tasks.view";
  }

  return {
    organisation,
    offices,
    departments,
    permissions,
    roles,
    people,
    peopleDirectory,
    audit,
    availability,
    wfhPolicies,
    leavePending,
    wfhPending,
    exceptions,
    workContext,
    tasks,
    taskCatalog,
    actorGrants,
    geofenceOptions,
    notificationDelivery,
  };
}
