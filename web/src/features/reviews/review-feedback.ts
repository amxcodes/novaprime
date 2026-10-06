import { REVIEW_FEEDBACK_MAX_LENGTH, normalizeReviewFeedback } from "../../../review-actions.js";

export type ReviewFeedbackValidation =
  | { ok: true; feedback: string }
  | { ok: false; reason: "required" | "too_long" | "stale_cycle_confirmation" };

/** Keep browser-side review notes aligned with the review API's normalizer. */
export function validateReviewFeedback(
  value: string,
  options: { staleDraft: boolean; confirmedCurrentCycle: boolean },
): ReviewFeedbackValidation {
  const feedback = normalizeReviewFeedback(value);
  if (!feedback) {
    return {
      ok: false,
      reason: value.trim() ? "too_long" : "required",
    };
  }
  if (options.staleDraft && !options.confirmedCurrentCycle) {
    return { ok: false, reason: "stale_cycle_confirmation" };
  }
  return { ok: true, feedback };
}

export const REVIEW_FEEDBACK_LIMIT = REVIEW_FEEDBACK_MAX_LENGTH;
