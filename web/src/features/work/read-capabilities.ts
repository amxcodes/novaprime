import {
  hasAnyPermissionGrant,
  hasPermissionGrant,
  type EffectivePermissionRead,
} from "../../app-shell/permission-grants.ts";

/** Independent data reads consumed by the Work product surface. */
export interface WorkReadPlan {
  assignments: boolean;
  sessions: boolean;
  timeline: boolean;
  reviews: boolean;
  reviewerRequests: boolean;
  handoverRequests: boolean;
  workContext: boolean;
  workContextView: boolean;
  taskDetail: boolean;
  tasks: boolean;
  taskCollection: boolean;
  taskCatalog: boolean;
  attendance: boolean;
  reviewerManagement: boolean;
}

const WORK_SCOPES = Object.freeze([
  "organisation", "client", "client_workstream", "group", "assigned_work",
]);
const TASK_COLLECTION_SCOPES = Object.freeze([
  "organisation", "client", "client_workstream", "group",
]);
const TASK_CREATE_SCOPES = TASK_COLLECTION_SCOPES;
const TASK_CATALOG_KEYS = Object.freeze([
  "tasks.catalog.view", "tasks.catalog.manage", "tasks.catalog.propose", "tasks.catalog.review",
]);

function emptyWorkReadPlan(): WorkReadPlan {
  return {
    assignments: false,
    sessions: false,
    timeline: false,
    reviews: false,
    reviewerRequests: false,
    handoverRequests: false,
    workContext: false,
    workContextView: false,
    taskDetail: false,
    tasks: false,
    taskCollection: false,
    taskCatalog: false,
    attendance: false,
    reviewerManagement: false,
  };
}


export interface WorkReadContext {
  /** Request links use existing actor-participant endpoints; the ID grants no authority by itself. */
  focusedCollaborationRequest?: "reviewer" | "handover";
}

/**
 * Plan only the Work reads consumed by a feature the actor can use.
 * These are client-side read-planning hints over server-issued grants; every
 * route still enforces identity, scope, and policy on the server.
 */
export function planWorkReads(
  read: (EffectivePermissionRead & { isSuperAdmin?: boolean; hasOpenWorkSession?: boolean }) | null | undefined,
  context: WorkReadContext = {},
): Readonly<WorkReadPlan> {
  const none = emptyWorkReadPlan();
  if (read?.readError || !Array.isArray(read?.grants)) return Object.freeze(none);

  const workContextView = hasAnyPermissionGrant(read, ["clients.view"], ["organisation", "client"])
    || hasAnyPermissionGrant(read, ["workstreams.view"], ["organisation", "client", "client_workstream"])
    || hasAnyPermissionGrant(read, ["groups.view"], ["organisation", "client_workstream", "group"])
    // /api/work-context includes only client targets authorized by this membership grant.
    || hasAnyPermissionGrant(read, ["clients.members.manage"], ["organisation", "client"]);
  const taskView = hasAnyPermissionGrant(read, ["tasks.view"], WORK_SCOPES);
  const taskCollectionView = hasAnyPermissionGrant(read, ["tasks.view"], TASK_COLLECTION_SCOPES);
  const canCreateTasks = hasAnyPermissionGrant(read, ["tasks.create"], TASK_CREATE_SCOPES);
  // /api/tasks returns task details and the full assignment roster. Assigned-work
  // users use the purpose-limited Mine projection instead.
  const canCreateAndViewTasks = canCreateTasks && taskCollectionView;
  const canActOnOwnAssignments = hasAnyPermissionGrant(read, [
    "tasks.edit", "tasks.start", "tasks.submit", "tasks.reviewer_request", "tasks.handover_request",
  ], WORK_SCOPES);
  const reviewer = hasAnyPermissionGrant(read, ["tasks.review", "tasks.reviewer_request"], WORK_SCOPES);
  const handover = hasAnyPermissionGrant(read, ["tasks.handover_request", "tasks.handover_accept"], WORK_SCOPES);
  const canViewOwnTimeline = read.grants.some((grant) =>
    grant.permissionKey === "work.timeline.view" && grant.selfApplicable === true,
  );
  const canViewOwnAttendance = read.grants.some((grant) =>
    grant.permissionKey === "attendance.view" && grant.selfApplicable === true,
  );

  return Object.freeze({
    assignments: taskView || canActOnOwnAssignments,
    sessions: read.hasOpenWorkSession === true || hasAnyPermissionGrant(read, ["tasks.start"], ["organisation", "assigned_work"]),
    timeline: canViewOwnTimeline,
    reviews: hasAnyPermissionGrant(read, ["tasks.review"], WORK_SCOPES),
    reviewerRequests: reviewer || context.focusedCollaborationRequest === "reviewer",
    handoverRequests: handover || context.focusedCollaborationRequest === "handover",
    workContext: workContextView || canCreateTasks,
    workContextView,
    taskDetail: taskView,
    tasks: canCreateAndViewTasks,
    taskCollection: taskCollectionView,
    // Catalog data is read only for the task composer; catalog management is
    // exposed separately through Work Setup.
    taskCatalog: canCreateTasks && hasAnyPermissionGrant(read, TASK_CATALOG_KEYS, ["organisation"]),
    attendance: canViewOwnAttendance,
    reviewerManagement: hasAnyPermissionGrant(read, ["tasks.reviewer_manage"], [
      "organisation", "client_workstream", "group", "assigned_work",
    ]),
  });
}
