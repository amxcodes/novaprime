import { expect, test } from "bun:test";
import { canReviewRequest } from "./review-capability.js";

test("review capability requires effective permission and a different requester", () => {
  expect(canReviewRequest("reviewer-1", "person-2", true)).toBe(true);
  expect(canReviewRequest("reviewer-1", "person-2", false)).toBe(false);
  expect(canReviewRequest("person-1", "person-1", true)).toBe(false);
  expect(canReviewRequest("person-1", "person-1", false)).toBe(false);
});
