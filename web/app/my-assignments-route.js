import { projectAssignmentCandidateRead } from "./assignment-candidates.js";

const fallbackCandidates = { reviewers: [], handoverTargets: [] };

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value) {
  return typeof value === "string" ? value : null;
}

function projectAssignment(row) {
  if (!isRecord(row)) return null;
  const assignmentId = typeof row.assignmentId === "string" ? row.assignmentId : "";
  const taskId = typeof row.taskId === "string" ? row.taskId : "";
  if (!assignmentId || !taskId) return null;

  const canViewTask = row.canViewTask === true;
  const projected = {
    assignmentId,
    taskId,
    title: typeof row.title === "string" ? row.title : "",
    canViewTask,
    status: typeof row.status === "string" ? row.status : "",
    dueDate: nullableText(row.dueDate),
    dueDateRevision: Number.isSafeInteger(row.dueDateRevision) ? row.dueDateRevision : 0,
    // These are server-computed capabilities, copied fail-closed. The UI must
    // never infer or broaden them from the actor's other grants.
    canEditDueDate: row.canEditDueDate === true,
    canStart: row.canStart === true,
    canSubmit: row.canSubmit === true,
    canRequestReviewer: row.canRequestReviewer === true,
    canRequestHandover: row.canRequestHandover === true,
    hasPendingReviewerRequest: row.hasPendingReviewerRequest === true,
    hasPendingHandoverRequest: row.hasPendingHandoverRequest === true,
  };

  // The Mine endpoint intentionally omits task-only details when the caller
  // cannot view the task. Keep that boundary explicit if the response grows.
  if (canViewTask) {
    if (typeof row.reviewRequired === "boolean") projected.reviewRequired = row.reviewRequired;
    if (typeof row.reviewBlockedReason === "string" || row.reviewBlockedReason === null) {
      projected.reviewBlockedReason = row.reviewBlockedReason;
    }
    if (typeof row.resolutionSource === "string" || row.resolutionSource === null) {
      projected.resolutionSource = row.resolutionSource;
    }
    if (typeof row.billingClass === "string") projected.billingClass = row.billingClass;
    if (typeof row.billingPolicySource === "string") projected.billingPolicySource = row.billingPolicySource;
    if (Number.isSafeInteger(row.billingPolicyRevision)) projected.billingPolicyRevision = row.billingPolicyRevision;
    if (isRecord(row.taskDefinition) && typeof row.taskDefinition.entryId === "string" &&
        Number.isSafeInteger(row.taskDefinition.revision)) {
      projected.taskDefinition = { entryId: row.taskDefinition.entryId, revision: row.taskDefinition.revision };
    } else if (row.taskDefinition === null) {
      projected.taskDefinition = null;
    }
    if (typeof row.isCorrection === "boolean") projected.isCorrection = row.isCorrection;
    if (typeof row.correctionReason === "string" || row.correctionReason === null) {
      projected.correctionReason = row.correctionReason;
    }
    if (isRecord(row.correctionOf) && typeof row.correctionOf.taskId === "string" &&
        typeof row.correctionOf.title === "string") {
      projected.correctionOf = { taskId: row.correctionOf.taskId, title: row.correctionOf.title };
    } else if (row.correctionOf === null) {
      projected.correctionOf = null;
    }
  }

  return projected;
}

/** Allowlist the server's Mine DTO without recalculating any permission. */
export function projectMyAssignmentsRead(result, readIssue) {
  const issue = readIssue(result, "your assignments");
  if (issue) {
    return {
      status: ["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"].includes(result?.readError)
        ? "denied" : "error",
      message: issue.message,
    };
  }

  if (!Array.isArray(result?.assignments)) {
    return {
      status: "error",
      message: "Your assignments could not be read. Refresh Work to try again.",
    };
  }
  const assignments = result.assignments.map(projectAssignment);
  if (assignments.some((assignment) => assignment === null)) {
    return {
      status: "error",
      message: "Your assignments could not be read. Refresh Work to try again.",
    };
  }

  return {
    status: "ready",
    data: {
      assignments,
      hasMore: result?.hasMore === true,
      nextCursor: typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : null,
      limit: Number.isSafeInteger(result?.limit) ? result.limit : 30,
    },
  };
}

/**
 * Compose the Mine feature's presentation contract while leaving endpoint
 * transport, grant planning, navigation, and protected commands in the host.
 */
export function createMyAssignmentsRoute(host) {
  const { isCurrentPageRequest, readAssignmentCandidates, mountReactIsland, readIssue } = host;
  const requiredFunctions = { isCurrentPageRequest, readAssignmentCandidates, mountReactIsland, readIssue };
  for (const [name, service] of Object.entries(requiredFunctions)) {
    if (typeof service !== "function") throw new TypeError("My Assignments route service " + name + " must be a function");
  }

  return function mountMyAssignments({
    authorized,
    target,
    lifetime,
    Component,
    result,
    filters,
    savedViews,
    focusHeading,
    taskDetailHref,
    callbacks = {},
  }) {
    if (authorized !== true || !target || !Component || !isCurrentPageRequest(lifetime)) return false;

    const read = projectMyAssignmentsRead(result, readIssue);
    const candidateReads = new Map();
    const onLoadCandidates = (assignment, { retry = false, query } = {}) => {
      if (!isCurrentPageRequest(lifetime)) {
        return Promise.resolve({ reviewers: [], handoverTargets: [], readError: "STALE_PAGE_REQUEST" });
      }
      const assignmentId = assignment?.assignmentId;
      if (typeof assignmentId !== "string" || !assignmentId) {
        return Promise.resolve({ reviewers: [], handoverTargets: [], readError: "ASSIGNMENT_UNAVAILABLE" });
      }
      if (typeof query === "string") {
        return Promise.resolve()
          .then(() => readAssignmentCandidates(assignmentId, lifetime, query))
          .then((result) => isCurrentPageRequest(lifetime)
            ? projectAssignmentCandidateRead(result)
            : { reviewers: [], handoverTargets: [], readError: "STALE_PAGE_REQUEST" })
          .catch((error) => isCurrentPageRequest(lifetime)
            ? { ...fallbackCandidates, readError: error?.code || "REQUEST_FAILED" }
            : { ...fallbackCandidates, readError: "STALE_PAGE_REQUEST" });
      }
      if (retry) candidateReads.delete(assignmentId);
      if (!candidateReads.has(assignmentId)) {
        candidateReads.set(assignmentId,
          Promise.resolve().then(() => readAssignmentCandidates(assignmentId, lifetime))
            .catch((error) => ({ ...fallbackCandidates, readError: error?.code || "REQUEST_FAILED" }))
            .then((result) => isCurrentPageRequest(lifetime)
              ? projectAssignmentCandidateRead(result)
              : { reviewers: [], handoverTargets: [], readError: "STALE_PAGE_REQUEST" }));
      }
      return candidateReads.get(assignmentId);
    };

    mountReactIsland(target, Component, {
      read,
      filters,
      savedViews,
      focusHeading: Boolean(focusHeading),
      taskDetailHref,
      onApplyFilters: callbacks.onApplyFilters,
      onClearFilters: callbacks.onClearFilters,
      onOpenTask: callbacks.onOpenTask,
      onStart: callbacks.onStart,
      onSubmit: callbacks.onSubmit,
      onSaveDueDate: callbacks.onSaveDueDate,
      onRequestReviewer: callbacks.onRequestReviewer,
      onRequestHandover: callbacks.onRequestHandover,
      onOlder: callbacks.onOlder,
      onNewer: callbacks.onNewer,
      onRetry: callbacks.onRetry,
      onLoadCandidates,
    });
    return true;
  };
}
