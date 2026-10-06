import { expect, test } from "bun:test";
import { parsePendingReviewTarget, pendingReviewsReadSql } from "./review-queue.js";

test("pending review reads are actor-owned, permission-filtered and side-effect free", () => {
  const sql = pendingReviewsReadSql.toUpperCase();
  expect(sql).toContain("ASSIGNMENTS.REVIEWER_PERSON_ID = $2");
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'TASKS.REVIEW'");
  expect(sql).toContain("AND ASSIGNMENTS.STATUS = 'AWAITING_REVIEW'");
  expect(sql).toContain("AND ASSIGNMENTS.REVIEWER_PERSON_ID = $2");
  expect(sql).toContain("ASSIGNMENTS.ID = $3");
  expect(sql).toContain("ASSIGNMENTS.TASK_ID = $4");
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);

  const permissionFilter = sql.indexOf("AND EXISTS (");
  const limit = sql.lastIndexOf("LIMIT 100");
  expect(permissionFilter).toBeGreaterThan(-1);
  expect(limit).toBeGreaterThan(permissionFilter);
});

test("focused review links accept one valid target and reject ambiguous or malformed targets", () => {
  const assignmentId = "00000000-0000-4000-8000-000000000001";
  const taskId = "00000000-0000-4000-8000-000000000002";
  expect(parsePendingReviewTarget(new URL("https://nova.test/api/reviews/pending"))).toEqual({});
  expect(parsePendingReviewTarget(new URL(`https://nova.test/api/reviews/pending?assignmentId=${assignmentId}`)))
    .toEqual({ assignmentId });
  expect(parsePendingReviewTarget(new URL(`https://nova.test/api/reviews/pending?taskId=${taskId}`)))
    .toEqual({ taskId });
  expect(parsePendingReviewTarget(new URL("https://nova.test/api/reviews/pending?assignmentId=bad"))).toBeNull();
  expect(parsePendingReviewTarget(new URL(`https://nova.test/api/reviews/pending?assignmentId=${assignmentId}&assignmentId=${assignmentId}`)))
    .toBeNull();
  expect(parsePendingReviewTarget(new URL(`https://nova.test/api/reviews/pending?assignmentId=${assignmentId}&taskId=${taskId}`)))
    .toBeNull();
});
