/** Fail closed: decision controls require the server's row-level capability hint. */
export function canRenderRequestReviewActions(request) {
  return request?.canReview === true;
}

/** Conflict decisions also rewrite attendance exceptions and need an explicit recovery grant. */
export function canRenderLeaveConflictAction(request) {
  return request?.hasConflict === true &&
    request?.canReview === true &&
    request?.canResolveConflict === true;
}

export const REVIEW_FEEDBACK_MAX_LENGTH = 2000;

/** Normalize a review note identically before browser submission and API validation. */
export function normalizeReviewFeedback(value) {
  if (typeof value !== "string") return null;
  const feedback = value.trim();
  return feedback.length > 0 && feedback.length <= REVIEW_FEEDBACK_MAX_LENGTH
    ? feedback
    : null;
}
