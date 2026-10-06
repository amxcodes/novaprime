import {
  pendingReviewsReadUrl,
  visibleTaskFilters,
  visibleTaskReadUrl,
  workAssignmentFilters,
  workAssignmentReadUrl,
  workCollaborationReadUrl,
} from "./work-route.js";

const emptyAssignments = () => ({ assignments: [] });
const emptySessions = () => ({ sessions: [] });
const emptyReviews = () => ({ reviews: [] });
const emptyRequests = () => ({ requests: [] });
const emptyContext = () => ({
  clients: [],
  clientWorkstreams: [],
  organisationWorkstreams: [],
  taskCreationTargets: [],
  groups: [],
});
const emptyTasks = () => ({ tasks: [] });
const emptyCatalog = () => ({ entries: [], proposals: [], permissions: {} });
const emptyAttendance = () => ({});
const emptyReviewerManagement = () => ({
  assignments: [],
  hasMore: false,
  nextCursor: null,
  limit: 25,
});

/**
 * Dispatch only the Work reads present in the already-authorized host plan.
 * This adapter owns URL/read composition, while the host supplies the current
 * page-bound reader and the server remains the final authorization authority.
 */
export async function readWorkRouteData({
  readPlan,
  hasReviewRoute = false,
  focusRequest = null,
  reviewTarget = {},
  date,
  searchParams = new URLSearchParams(),
  lifetime,
  pageApi,
} = {}) {
  if (!readPlan || typeof readPlan !== "object") throw new TypeError("Work read plan is required");
  if (typeof pageApi !== "function") throw new TypeError("Work route API reader must be a function");

  const fallbackDate = date || new Date().toISOString().slice(0, 10);
  const focusedRoute = hasReviewRoute || focusRequest !== null;
  const nonFocusedFeatureReads = !focusedRoute;
  const read = (enabled, path, fallback) => {
    if (!enabled) return Promise.resolve(fallback);
    try {
      return Promise.resolve(pageApi(path, lifetime)).catch((error) => ({
        ...fallback,
        readError: error?.code || "REQUEST_FAILED",
      }));
    } catch (error) {
      return Promise.resolve({ ...fallback, readError: error?.code || "REQUEST_FAILED" });
    }
  };
  const assignmentFilter = workAssignmentFilters(searchParams);
  const visibleTaskFilter = visibleTaskFilters(searchParams);

  const [
    assignmentsResult,
    sessionsResult,
    timeline,
    reviewsResult,
    reviewerRequestsResult,
    handoverRequestsResult,
    workContext,
    tasksResult,
    visibleTasksResult,
    taskCatalogResult,
    attendanceResult,
    reviewerManagementResult,
  ] = await Promise.all([
    read(nonFocusedFeatureReads && readPlan.assignments,
      workAssignmentReadUrl(assignmentFilter), emptyAssignments()),
    read(nonFocusedFeatureReads && readPlan.sessions,
      "/api/work-sessions/mine", emptySessions()),
    read(nonFocusedFeatureReads && readPlan.timeline,
      "/api/work/timeline" + (date ? "?date=" + encodeURIComponent(date) : ""), {
        date: fallbackDate,
        events: [],
        exceptions: [],
      }),
    read(readPlan.reviews && !focusRequest,
      pendingReviewsReadUrl(reviewTarget || {}), emptyReviews()),
    read(readPlan.reviewerRequests && (!focusedRoute || focusRequest?.kind === "reviewer"),
      workCollaborationReadUrl("reviewer", focusRequest?.kind === "reviewer" ? focusRequest.id : undefined), emptyRequests()),
    read(readPlan.handoverRequests && (!focusedRoute || focusRequest?.kind === "handover"),
      workCollaborationReadUrl("handover", focusRequest?.kind === "handover" ? focusRequest.id : undefined), emptyRequests()),
    read(nonFocusedFeatureReads && readPlan.workContext,
      "/api/work-context", emptyContext()),
    read(nonFocusedFeatureReads && readPlan.tasks,
      "/api/tasks", emptyTasks()),
    read(nonFocusedFeatureReads && readPlan.taskCollection,
      visibleTaskReadUrl(visibleTaskFilter), emptyTasks()),
    read(nonFocusedFeatureReads && readPlan.taskCatalog,
      "/api/task-catalog", emptyCatalog()),
    read(nonFocusedFeatureReads && readPlan.attendance,
      "/api/attendance/today", emptyAttendance()),
    read(nonFocusedFeatureReads && readPlan.reviewerManagement,
      "/api/task-assignments/reviewer-management?limit=25", emptyReviewerManagement()),
  ]);

  return {
    assignmentsResult,
    sessionsResult,
    timeline,
    reviewsResult,
    reviewerRequestsResult,
    handoverRequestsResult,
    workContext,
    tasksResult,
    visibleTasksResult,
    taskCatalogResult,
    attendanceResult,
    reviewerManagementResult,
  };
}
