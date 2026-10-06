import { expect, test } from "bun:test";
import { parseReviewDecisionInput } from "./reviews.js";

const cycleId = "00000000-0000-4000-8000-000000000001";

test("review decisions require the exact cycle and allow approval without feedback", () => {
  expect(parseReviewDecisionInput({
    decision: "approved",
    expectedReviewCycleId: cycleId,
  })).toEqual({
    decision: "approved",
    expectedReviewCycleId: cycleId,
    feedback: null,
  });
});

test("changes requested requires bounded nonblank feedback and a valid cycle id", () => {
  expect(parseReviewDecisionInput({
    decision: "changes_requested",
    expectedReviewCycleId: cycleId,
    feedback: "  Add the missing acceptance criteria.  ",
  })).toEqual({
    decision: "changes_requested",
    expectedReviewCycleId: cycleId,
    feedback: "Add the missing acceptance criteria.",
  });
  expect(parseReviewDecisionInput({
    decision: "changes_requested",
    expectedReviewCycleId: cycleId,
    feedback: "  \n  ",
  })).toBeNull();
  expect(parseReviewDecisionInput({
    decision: "changes_requested",
    expectedReviewCycleId: cycleId,
    feedback: "x".repeat(2001),
  })).toBeNull();
  expect(parseReviewDecisionInput({
    decision: "approved",
    feedback: null,
  })).toBeNull();
});
