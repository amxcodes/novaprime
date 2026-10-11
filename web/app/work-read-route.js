import {
  getAvailableWorkAreas,
  isWorkReadIncludedInArea,
  resolveWorkAreaId,
} from "./work-areas.js";
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
  workArea,
  canCreateTasks = false,
  lifetime,
  pageApi,
} = {}) {
  if (!readPlan || typeof readPlan !== "object") throw new TypeError("Work read plan is required");
  if (typeof pageApi !== "function") throw new TypeError("Work route API reader must be a function");

  const fallbackDate = date || new Date().toISOString().slice(0, 10);
  const focusedRoute = hasReviewRoute || focusRequest !== null;
  const nonFocusedFeatureReads = !focusedRoute;
  const availableAreas = getAvailableWorkAreas(readPlan, canCreateTasks);
  const requestedAreaId = typeof workArea === "string" ? workArea : workArea?.id;
  const workAreaId = resolveWorkAreaId(requestedAreaId || searchParams.get("area"), availableAreas);
  const assignmentFilter = workAssignmentFilters(searchParams);
  const visibleTaskFilter = visibleTaskFilters(searchParams);

  const requestedReads = [
    {
      key: "assignmentsResult",
      enabled: nonFocusedFeatureReads && readPlan.assignments,
      path: workAssignmentReadUrl(assignmentFilter),
      fallback: emptyAssignments,
    },
    { key: "sessionsResult", enabled: nonFocusedFeatureReads && readPlan.sessions, path: "/api/work-sessions/mine", fallback: emptySessions, batchable: false },
    {
      key: "timeline",
      enabled: nonFocusedFeatureReads && readPlan.timeline,
      path: "/api/work/timeline" + (date ? "?date=" + encodeURIComponent(date) : ""),
      fallback: () => ({ date: fallbackDate, events: [], exceptions: [] }),
    },
    { key: "reviewsResult", enabled: readPlan.reviews && !focusRequest, path: pendingReviewsReadUrl(reviewTarget || {}), fallback: emptyReviews },
    {
      key: "reviewerRequestsResult",
      enabled: readPlan.reviewerRequests && (!focusedRoute || focusRequest?.kind === "reviewer"),
      path: workCollaborationReadUrl("reviewer", focusRequest?.kind === "reviewer" ? focusRequest.id : undefined),
      fallback: emptyRequests,
    },
    {
      key: "handoverRequestsResult",
      enabled: readPlan.handoverRequests && (!focusedRoute || focusRequest?.kind === "handover"),
      path: workCollaborationReadUrl("handover", focusRequest?.kind === "handover" ? focusRequest.id : undefined),
      fallback: emptyRequests,
    },
    { key: "workContext", enabled: nonFocusedFeatureReads && readPlan.workContext, path: "/api/work-context", fallback: emptyContext, batchable: false },
    { key: "tasksResult", enabled: nonFocusedFeatureReads && readPlan.tasks, path: "/api/tasks", fallback: emptyTasks, batchable: false },
    { key: "visibleTasksResult", enabled: nonFocusedFeatureReads && readPlan.taskCollection, path: visibleTaskReadUrl(visibleTaskFilter), fallback: emptyTasks },
    { key: "taskCatalogResult", enabled: nonFocusedFeatureReads && readPlan.taskCatalog, path: "/api/task-catalog", fallback: emptyCatalog },
    { key: "attendanceResult", enabled: nonFocusedFeatureReads && readPlan.attendance, path: "/api/attendance/today", fallback: emptyAttendance },
    {
      key: "reviewerManagementResult",
      enabled: nonFocusedFeatureReads && readPlan.reviewerManagement,
      path: "/api/task-assignments/reviewer-management?limit=25",
      fallback: emptyReviewerManagement,
    },
  ];
  const activeReads = requestedReads.filter((read) => read.enabled && (
    focusedRoute || isWorkReadIncludedInArea(read.key, workAreaId, canCreateTasks)
  ));
  const batchReads = activeReads.filter((read) => read.batchable !== false);
  const standaloneReads = activeReads.filter((read) => read.batchable === false);
  const results = Object.fromEntries(requestedReads.map((read) => [read.key, read.fallback()]));

  const readDirectly = async (read) => {
    try {
      results[read.key] = await pageApi(read.path, lifetime);
    } catch (error) {
      results[read.key] = { ...read.fallback(), readError: error?.code || "REQUEST_FAILED" };
    }
  };
  const readBatch = async () => {
    if (batchReads.length === 0) return;
    if (batchReads.length === 1) return readDirectly(batchReads[0]);
    try {
      const response = await pageApi("/api/work/page-read", lifetime, {
        method: "POST",
        body: { reads: batchReads.map((read) => read.path) },
        readOnly: true,
      });
      if (!Array.isArray(response?.reads) || response.reads.length !== batchReads.length) {
        throw Object.assign(new Error("Invalid Work page read response"), { code: "REQUEST_FAILED" });
      }
      for (let index = 0; index < batchReads.length; index += 1) {
        const read = batchReads[index];
        const item = response.reads[index];
        if (!item || item.path !== read.path || !Number.isInteger(item.status)) {
          results[read.key] = { ...read.fallback(), readError: "REQUEST_FAILED" };
        } else if (item.status >= 200 && item.status < 300 && item.body && typeof item.body === "object") {
          results[read.key] = item.body;
        } else {
          const code = item.body && typeof item.body === "object"
            ? item.body.error || item.body.code
            : undefined;
          results[read.key] = { ...read.fallback(), readError: typeof code === "string" ? code : "REQUEST_FAILED" };
        }
      }
    } catch (error) {
      for (const read of batchReads) {
        results[read.key] = { ...read.fallback(), readError: error?.code || "REQUEST_FAILED" };
      }
    }
  };
  await Promise.all([...standaloneReads.map(readDirectly), readBatch()]);

  return {
    assignmentsResult: results.assignmentsResult,
    sessionsResult: results.sessionsResult,
    timeline: results.timeline,
    reviewsResult: results.reviewsResult,
    reviewerRequestsResult: results.reviewerRequestsResult,
    handoverRequestsResult: results.handoverRequestsResult,
    workContext: results.workContext,
    tasksResult: results.tasksResult,
    visibleTasksResult: results.visibleTasksResult,
    taskCatalogResult: results.taskCatalogResult,
    attendanceResult: results.attendanceResult,
    reviewerManagementResult: results.reviewerManagementResult,
  };
}
