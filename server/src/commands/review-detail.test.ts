import { expect, test } from "bun:test";
import { reviewerReviewDetailDto, reviewerReviewDetailReadSql, type ReviewerReviewRow } from "./review-detail.js";

const base: ReviewerReviewRow = {
  assignment_id: "00000000-0000-4000-8000-000000000001",
  task_id: "00000000-0000-4000-8000-000000000002",
  assignee_name: "Avery Employee",
  title: "Prepare monthly close",
  description: "Reconcile the outstanding items.",
  task_status: "submitted",
  priority: "high",
  due_date: "2026-10-08",
  client_id: "00000000-0000-4000-8000-000000000004",
  client_name: "Example Client",
  client_workstream_id: "00000000-0000-4000-8000-000000000005",
  client_workstream_name: "Finance",
  organisation_workstream_id: null,
  organisation_workstream_name: null,
  group_id: null,
  group_name: null,
  current_cycle_id: "00000000-0000-4000-8000-000000000010",
  current_cycle_number: 2,
  current_submitted_at: new Date("2026-10-02T05:00:00.000Z"),
  history_cycle_id: "00000000-0000-4000-8000-000000000009",
  history_cycle_number: 1,
  history_submitted_at: new Date("2026-09-29T05:00:00.000Z"),
  history_decided_at: new Date("2026-09-30T05:00:00.000Z"),
  history_decision: "changes_requested",
  history_feedback: "Please add the source document.",
  history_total: 2,
};

test("review detail requires the current assigned reviewer and target-scoped tasks.review", () => {
  const sql = reviewerReviewDetailReadSql.toUpperCase();
  expect(sql).toContain("ASSIGNMENTS.STATUS = 'AWAITING_REVIEW'");
  expect(sql).toContain("ASSIGNMENTS.REVIEWER_PERSON_ID = $2");
  expect(sql).toContain("CURRENT_CYCLE.REVIEWER_PERSON_ID = $2");
  expect(sql).toContain("CURRENT_CYCLE.DECIDED_AT IS NULL");
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'TASKS.REVIEW'");
  expect(sql).toContain("GRANTS.SCOPE = 'ASSIGNED_WORK' AND EXISTS");
  expect(sql).not.toContain("GRANTS.PERMISSION_KEY = 'TASKS.VIEW'");
  expect(sql).toContain("CYCLES.ASSIGNMENT_ID = CURRENT_REVIEW.ASSIGNMENT_ID");
  expect(sql).toContain("LIMIT 50");
  expect(sql).not.toContain("EMAIL");
  expect(sql).not.toContain("CYCLES.REVIEWER_PERSON_ID = $2");
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
});

test("review detail DTO returns the assignment's prior feedback and marks the open cycle", () => {
  const current = {
    ...base,
    history_cycle_id: base.current_cycle_id,
    history_cycle_number: 2,
    history_submitted_at: base.current_submitted_at,
    history_decided_at: null,
    history_decision: null,
    history_feedback: null,
  };
  const dto = reviewerReviewDetailDto([base, current]);
  expect(dto?.review).toMatchObject({
    assignmentId: base.assignment_id,
    taskId: base.task_id,
    assignee: { displayName: base.assignee_name },
    task: { title: base.title, priority: "high", dueDate: "2026-10-08" },
    workstream: { id: base.client_workstream_id, kind: "client" },
    currentReviewCycleId: base.current_cycle_id,
  });
  expect(dto?.history).toEqual([
    expect.objectContaining({ cycleNumber: 1, decision: "changes_requested", feedback: "Please add the source document.", isCurrent: false }),
    expect.objectContaining({ cycleNumber: 2, decision: null, feedback: null, isCurrent: true }),
  ]);
  expect(dto?.historyTruncated).toBe(false);
  expect(reviewerReviewDetailDto([])).toBeUndefined();
});

test("review detail exposes whether assignment history reached the cap", () => {
  const dto = reviewerReviewDetailDto([{ ...base, history_total: 51 }]);
  expect(dto?.history).toHaveLength(1);
  expect(dto?.historyTruncated).toBe(true);
});
