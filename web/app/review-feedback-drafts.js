/** Actor- and review-access-scoped in-memory drafts for the Work Reviews host. */
export function createReviewFeedbackDraftStore() {
  let actorId = null;
  let accessKey = null;
  let byAssignmentId = new Map();

  function prepare(nextActorId, nextAccessKey) {
    if (!nextActorId) return;
    if (actorId !== nextActorId || accessKey !== nextAccessKey) {
      actorId = nextActorId;
      accessKey = nextAccessKey;
      byAssignmentId = new Map();
    }
  }

  function currentFor(nextActorId) {
    return Boolean(nextActorId && actorId === nextActorId);
  }

  return {
    prepare,
    read(nextActorId, assignmentId) {
      if (!currentFor(nextActorId)) return undefined;
      return byAssignmentId.get(assignmentId)?.draft;
    },
    save(nextActorId, assignmentId, draft, taskId) {
      if (!currentFor(nextActorId) || !assignmentId) return;
      byAssignmentId.set(assignmentId, { draft, taskId: typeof taskId === "string" ? taskId : null });
    },
    clear(nextActorId, assignmentId) {
      if (!currentFor(nextActorId)) return;
      byAssignmentId.delete(assignmentId);
    },
    clearForTask(nextActorId, taskId) {
      if (!currentFor(nextActorId) || !taskId) return;
      for (const [assignmentId, entry] of byAssignmentId) {
        if (entry.taskId === taskId) byAssignmentId.delete(assignmentId);
      }
    },
    retainAssignments(nextActorId, assignmentIds) {
      if (!currentFor(nextActorId) || !Array.isArray(assignmentIds)) return;
      const visible = new Set(assignmentIds);
      for (const assignmentId of byAssignmentId.keys()) {
        if (!visible.has(assignmentId)) byAssignmentId.delete(assignmentId);
      }
    },
    clear() {
      actorId = null;
      accessKey = null;
      byAssignmentId = new Map();
    },
  };
}

/** Drop drafts whose review target is no longer present in the current authorized read. */
export function reconcileReviewFeedbackDraftAccess(store, actorId, {
  reviewsResult,
  reviewDetailResult,
  reviewTarget,
  hasReviewRoute,
  selectedReview,
} = {}) {
  const denied = (result) => ["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"].includes(result?.readError);
  let refreshPermissions = false;
  if (denied(reviewsResult)) {
    store.clear();
    refreshPermissions = true;
  } else if (actorId && Array.isArray(reviewsResult?.reviews) && !reviewsResult.readError) {
    const rows = reviewsResult.reviews;
    if (hasReviewRoute && reviewTarget?.assignmentId) {
      if (!rows.some((item) => item?.assignmentId === reviewTarget.assignmentId)) {
        store.clear(actorId, reviewTarget.assignmentId);
      }
    } else if (hasReviewRoute && reviewTarget?.taskId) {
      if (!rows.some((item) => item?.taskId === reviewTarget.taskId)) {
        store.clearForTask(actorId, reviewTarget.taskId);
      }
    } else {
      store.retainAssignments(actorId,
        rows.map((item) => item?.assignmentId).filter((assignmentId) => typeof assignmentId === "string"));
    }
  }
  if (denied(reviewDetailResult) && selectedReview?.assignmentId) {
    store.clear(actorId, selectedReview.assignmentId);
    refreshPermissions = true;
  }
  return { refreshPermissions };
}
