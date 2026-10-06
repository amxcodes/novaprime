const deniedReadCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);
const unavailableContextCodes = new Set(["REVIEW_NOT_FOUND", "REVIEW_NOT_OPEN"]);

/** Bind review decisions to host-owned transport, permission recovery, and route lifetime. */
export function createWorkReviewActions({
  target,
  api,
  requestOptions,
  captureCommandContext,
  isCurrentCommand,
  isCurrentCommandIdentity,
  recoverProtectedCommandFailure,
  clearDraft,
  setMessage,
  errorText,
  refreshWork,
  openReviewContext,
  saveDraft,
} = {}) {
  const requiredServices = {
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    clearDraft,
    setMessage,
    errorText,
    refreshWork,
    openReviewContext,
    saveDraft,
  };
  for (const [name, service] of Object.entries(requiredServices)) {
    if (typeof service !== "function") throw new TypeError(`Work Reviews action service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Work Reviews action target is required");

  async function decide(review, decision, feedback) {
    const context = captureCommandContext(target);
    try {
      await api("/api/task-assignments/" + encodeURIComponent(review.assignmentId) + "/review", requestOptions("POST", {
        decision,
        expectedReviewCycleId: review.reviewCycleId,
        feedback,
      }));
    } catch (error) {
      if (decision === "changes_requested" &&
          (error?.code === "REVIEW_CYCLE_STALE" || error?.code === "REVIEW_NOT_OPEN") &&
          isCurrentCommand(context)) {
        setMessage(errorText(error), "warning");
        await refreshWork();
        return;
      }
      if (error?.httpStatus === 403) clearDraft(review.assignmentId);
      if (!isCurrentCommandIdentity(context)) return;
      if (recoverProtectedCommandFailure(error, context, "Your review access changed. Available actions have been refreshed.")) return;
      if (!isCurrentCommand(context)) return;
      throw error;
    }
    if (isCurrentCommandIdentity(context)) clearDraft(review.assignmentId);
    if (!isCurrentCommand(context)) return;
    setMessage(decision === "approved"
      ? "Work approved."
      : "Changes requested. The note is saved in review history and sent to the assignee.");
    void refreshWork();
  }

  return {
    onOpenContext: openReviewContext,
    onApprove: (review) => decide(review, "approved", null),
    onRequestChanges: (review, feedback) => decide(review, "changes_requested", feedback),
    onDraftChange: saveDraft,
    onRetryQueue: refreshWork,
    onRetryContext: refreshWork,
  };
}

/** Project the already-authorized queue and optional review detail into UI-safe props. */
export function projectWorkReviews({
  reviewsResult,
  reviewDetailResult,
  hasReviewRoute,
  selectedReview,
  readIssue,
  canDecide,
  readDraft,
}) {
  const reviews = Array.isArray(reviewsResult?.reviews) ? reviewsResult.reviews : [];
  const queueIssue = typeof readIssue === "function" ? readIssue(reviewsResult, "pending reviews") : undefined;
  const reviewReadFailed = Boolean(queueIssue);
  const queue = queueIssue
    ? deniedReadCodes.has(reviewsResult?.readError)
      ? { status: "denied", message: queueIssue.message }
      : { status: "error", message: queueIssue.message }
    : reviews.length
      ? {
        status: "ready",
        reviews: reviews.map((review) => ({
          assignmentId: review.assignmentId,
          title: review.title,
          reviewCycleId: review.reviewCycleId,
          cycleNumber: review.cycleNumber,
          submittedAt: review.submittedAt,
          canDecide: typeof canDecide === "function" && canDecide(review),
          draft: typeof readDraft === "function" ? readDraft(review.assignmentId) || null : null,
        })),
        requestLimit: 100,
      }
      : { status: "empty" };

  let context;
  if (hasReviewRoute) {
    const detailIssue = reviewDetailResult && typeof readIssue === "function"
      ? readIssue(reviewDetailResult, "review context")
      : undefined;
    if (!reviewDetailResult || !reviewDetailResult.review) {
      context = detailIssue
        ? unavailableContextCodes.has(reviewDetailResult?.readError)
          ? { status: "unavailable", message: detailIssue.message }
          : deniedReadCodes.has(reviewDetailResult?.readError)
            ? { status: "denied", message: detailIssue.message }
            : { status: "error", message: detailIssue.message }
        : { status: "unavailable", message: "This review is no longer open to you or is outside your current access." };
    } else {
      const detail = reviewDetailResult.review;
      context = {
        status: "ready",
        detail: {
          review: {
            assigneeName: detail.assignee?.displayName || null,
            taskTitle: detail.task?.title || "",
            taskDescription: detail.task?.description || null,
            taskStatus: detail.task?.status || null,
            priority: detail.task?.priority || null,
            dueDate: detail.task?.dueDate || null,
            clientName: detail.client?.name || null,
            workstreamName: detail.workstream?.name || null,
            groupName: detail.group?.name || null,
            submittedAt: detail.submittedAt || null,
          },
          history: Array.isArray(reviewDetailResult.history)
            ? reviewDetailResult.history.map((cycle) => ({
              reviewCycleId: cycle.reviewCycleId,
              cycleNumber: cycle.cycleNumber,
              decision: cycle.decision || null,
              submittedAt: cycle.submittedAt,
              decidedAt: cycle.decidedAt || null,
              feedback: cycle.feedback || null,
              isCurrent: cycle.isCurrent === true,
            }))
            : [],
          historyTruncated: reviewDetailResult.historyTruncated === true,
        },
      };
    }
  }

  return {
    queue,
    ...(context ? { context } : {}),
    focusAssignmentId: !reviewReadFailed && hasReviewRoute ? selectedReview?.assignmentId : undefined,
    reviewReadFailed,
  };
}

/** Mount the feature with projected reads and host-owned actions, or its existing local fallback. */
export function mountWorkReviewsRoute(target, { feature, loadError, projection, actions }, host) {
  if (feature?.ReviewsPage) {
    host.mountReactIsland(target, feature.ReviewsPage, {
      queue: projection.queue,
      ...(projection.context ? { context: projection.context } : {}),
      focusAssignmentId: projection.focusAssignmentId,
      ...actions,
    });
    return { mounted: true, reviewReadFailed: projection.reviewReadFailed };
  }

  host.showWorkFeatureMessage(target, "Reviews are unavailable",
    loadError ? "The review interface could not load. Refresh the page to try again." : "The review interface is unavailable.",
  );
  return { mounted: false, reviewReadFailed: projection.reviewReadFailed };
}
