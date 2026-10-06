import { expect, test } from "bun:test";
import {
  canRenderLeaveConflictAction,
  canRenderRequestReviewActions,
  normalizeReviewFeedback,
  REVIEW_FEEDBACK_MAX_LENGTH,
} from "../web/review-actions.js";

test("request review controls render only when the server grants the row capability", () => {
  expect(canRenderRequestReviewActions({ canReview: true })).toBe(true);
  expect(canRenderRequestReviewActions({ canReview: false })).toBe(false);
  expect(canRenderRequestReviewActions({})).toBe(false);
  expect(canRenderRequestReviewActions(undefined)).toBe(false);
  expect(canRenderRequestReviewActions({ canReview: "true" })).toBe(false);
});

test("leave conflict decisions require review and attendance-recovery capabilities", () => {
  expect(canRenderLeaveConflictAction({ hasConflict: true, canReview: true, canResolveConflict: true })).toBe(true);
  expect(canRenderLeaveConflictAction({ hasConflict: true, canReview: true, canResolveConflict: false })).toBe(false);
  expect(canRenderLeaveConflictAction({ hasConflict: true, canReview: false, canResolveConflict: true })).toBe(false);
  expect(canRenderLeaveConflictAction({ hasConflict: false, canReview: true, canResolveConflict: true })).toBe(false);
  expect(canRenderLeaveConflictAction({ hasConflict: true, canReview: true })).toBe(false);
});

test("review feedback is trimmed, required, and bounded by the shared input limit", () => {
  expect(normalizeReviewFeedback("  Make the ownership explicit.  ")).toBe("Make the ownership explicit.");
  expect(normalizeReviewFeedback(" \n ")).toBeNull();
  expect(normalizeReviewFeedback(42)).toBeNull();
  expect(normalizeReviewFeedback("x".repeat(REVIEW_FEEDBACK_MAX_LENGTH))).toHaveLength(REVIEW_FEEDBACK_MAX_LENGTH);
  expect(normalizeReviewFeedback("x".repeat(REVIEW_FEEDBACK_MAX_LENGTH + 1))).toBeNull();
});
