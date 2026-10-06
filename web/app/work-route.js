const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCollaborationRequestId(value) {
  return isUuid(value);
}

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Read a typed collaboration-request destination without treating a request
 * ID as authority. The matching participant-scoped endpoint still decides
 * whether the signed-in actor can read a record.
 */
export function readFocusedCollaborationRequest(params) {
  const reviewerIds = params.getAll("reviewerRequest");
  const handoverIds = params.getAll("handoverRequest");
  if (!reviewerIds.length && !handoverIds.length) return { status: "none" };
  // A typed request link must have one unambiguous destination. Task detail
  // and review routes have their own IDs and must not silently take precedence.
  if (params.has("task") || params.has("review")) return { status: "invalid" };
  if (reviewerIds.length + handoverIds.length !== 1) return { status: "invalid" };

  const kind = reviewerIds.length ? "reviewer" : "handover";
  const id = reviewerIds[0] || handoverIds[0];
  return isCollaborationRequestId(id) ? { status: "focused", kind, id } : { status: "invalid" };
}

/** Build the optional exact-record filter for one actor-participant read. */
export function workCollaborationReadUrl(kind, requestId) {
  const path = kind === "reviewer" ? "/api/task-reviewer-requests" : "/api/task-handover-requests";
  if (!requestId) return path;
  if (!isCollaborationRequestId(requestId)) throw new TypeError("Invalid collaboration request ID.");
  const query = new URLSearchParams({ requestId });
  return `${path}?${query.toString()}`;
}

const TASK_DETAIL_PRESERVED_FILTERS = Object.freeze([
  "assignmentStatus",
  "assignmentDue",
  "assignmentSearch",
  "assignmentCursor",
  "taskStatus",
  "taskDue",
  "taskSearch",
  "taskCursor",
  "taskLayout",
]);

/** Create a task detail URL while carrying forward only current Work filters. */
export function taskDetailUrl(taskId, currentParams = new URLSearchParams()) {
  const params = new URLSearchParams({ view: "work", task: taskId });
  if (currentParams.get("view") === "work") {
    for (const key of TASK_DETAIL_PRESERVED_FILTERS) {
      const value = currentParams.get(key);
      if (value) params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}

export function workAssignmentFilters(params) {
  return {
    status: params.get("assignmentStatus") || "all",
    due: params.get("assignmentDue") || "any",
    search: params.get("assignmentSearch") || "",
    cursor: params.get("assignmentCursor") || "",
  };
}

export function workAssignmentReadUrl(filters) {
  const query = new URLSearchParams({ limit: "30" });
  if (filters.status !== "all") query.set("status", filters.status);
  if (filters.due !== "any") query.set("due", filters.due);
  if (filters.search) query.set("q", filters.search);
  if (filters.cursor) query.set("cursor", filters.cursor);
  return `/api/work/assignments/mine?${query.toString()}`;
}

export function visibleTaskFilters(params) {
  return {
    status: params.get("taskStatus") || "open",
    due: params.get("taskDue") || "any",
    search: params.get("taskSearch") || "",
    cursor: params.get("taskCursor") || "",
  };
}

export function visibleTaskReadUrl(filters) {
  const query = new URLSearchParams({ limit: "30" });
  if (filters.status !== "open") query.set("status", filters.status);
  if (filters.due !== "any") query.set("due", filters.due);
  if (filters.search) query.set("q", filters.search);
  if (filters.cursor) query.set("cursor", filters.cursor);
  return `/api/work/tasks/visible?${query.toString()}`;
}

export function pendingReviewsReadUrl(target = {}) {
  const query = new URLSearchParams();
  if (target.assignmentId) query.set("assignmentId", target.assignmentId);
  else if (target.taskId) query.set("taskId", target.taskId);
  const search = query.toString();
  return "/api/reviews/pending" + (search ? `?${search}` : "");
}

/** A bare task ID only opens reviewer mode when the actor has review access. */
export function isPendingReviewRoute({ reviewId, taskId, taskDetail, reviews }) {
  return Boolean(reviewId || (taskId && !taskDetail && reviews));
}

/** Resolve route presentation and feature imports from the host's existing read plan. */
export function resolveWorkRouteContext({
  searchParams,
  readPlan,
  canCreateTasks = false,
  canActOnTasks = false,
  focusedCollaboration,
} = {}) {
  if (!(searchParams instanceof URLSearchParams)) throw new TypeError("Work route search parameters are required");
  if (!readPlan || typeof readPlan !== "object") throw new TypeError("Work route read plan is required");

  const taskId = searchParams.get("task");
  const reviewId = searchParams.get("review");
  const collaborationRoute = focusedCollaboration || readFocusedCollaborationRequest(searchParams);
  const focusRequest = collaborationRoute.status === "focused"
    ? { kind: collaborationRoute.kind, id: collaborationRoute.id }
    : null;
  const hasFocusedCollaborationRoute = Boolean(focusRequest);
  const taskDetailRoute = Boolean(taskId && readPlan.taskDetail);
  const reviewTarget = reviewId
    ? { assignmentId: reviewId }
    : taskId && !readPlan.taskDetail && readPlan.reviews
      ? { taskId }
      : null;
  const hasReviewRoute = isPendingReviewRoute({
    reviewId,
    taskId,
    taskDetail: readPlan.taskDetail,
    reviews: readPlan.reviews,
  });
  const validReviewTarget = Boolean(reviewTarget) && Object.values(reviewTarget).every(isUuid);

  const workDescription = canActOnTasks || readPlan.sessions
    ? "Use permitted assignment actions and track productive time separately from attendance."
    : canCreateTasks && !readPlan.taskCollection && !readPlan.assignments
      ? "Create tasks in workstreams available under your access."
      : readPlan.taskCollection || readPlan.assignments
        ? "Review tasks and assignments available under your access."
        : readPlan.reviews
          ? "Review submitted work available to you."
          : readPlan.workContextView
            ? "Browse client, workstream, and group context available under your access."
            : "Review work and context available under your access.";
  const workPageTitle = taskDetailRoute
    ? "Task details"
    : hasReviewRoute
      ? "Pending review"
      : focusRequest
        ? "Collaboration request"
        : "Work";
  const invalidFocusedRoute = collaborationRoute.status === "invalid";
  const standardFeatureRoute = !taskDetailRoute && !hasReviewRoute && !hasFocusedCollaborationRoute;
  const reviewSectionRoute = !taskDetailRoute && !hasFocusedCollaborationRoute;
  const collaborationSectionRoute = !taskDetailRoute && !hasReviewRoute;
  const canLoadFeature = (enabled) => Boolean(enabled && !invalidFocusedRoute);

  return {
    taskId,
    reviewId,
    focusedCollaboration: collaborationRoute,
    focusRequest,
    hasFocusedCollaborationRoute,
    taskDetailRoute,
    reviewTarget,
    hasReviewRoute,
    validReviewTarget,
    workDescription,
    workPageTitle,
    featureImports: {
      taskDetail: canLoadFeature(taskDetailRoute),
      workContext: canLoadFeature(readPlan.workContextView && standardFeatureRoute),
      reviews: canLoadFeature(readPlan.reviews && reviewSectionRoute),
      collaboration: canLoadFeature((readPlan.reviewerRequests || readPlan.handoverRequests) && collaborationSectionRoute),
      taskComposer: canLoadFeature(canCreateTasks && standardFeatureRoute),
      sessions: canLoadFeature(readPlan.sessions && standardFeatureRoute),
      timeline: canLoadFeature((readPlan.timeline || readPlan.attendance) && standardFeatureRoute),
      assignments: canLoadFeature(readPlan.assignments && standardFeatureRoute),
      savedTaskViews: canLoadFeature((readPlan.assignments || readPlan.taskCollection) && standardFeatureRoute),
      visibleTasks: canLoadFeature(readPlan.taskCollection && standardFeatureRoute),
      reviewerManagement: canLoadFeature(readPlan.reviewerManagement && standardFeatureRoute),
    },
  };
}
