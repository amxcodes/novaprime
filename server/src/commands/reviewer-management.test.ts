import { expect, test } from "bun:test";
import {
  parseReviewerCandidatePage,
  parseReviewerManagementPage,
  projectReviewerManagementAssignment,
  reviewerEligibleCandidatesReadSql,
  reviewerExceptionCandidatesReadSql,
  reviewerExceptionTargetReadSql,
  reviewerManagementFocusedReadSql,
  reviewerManagementListReadSql,
} from "./reviewer-management.js";

const assignmentId = "9f7fda96-7352-4e96-9ce0-71c0de51f761";

function reviewerManagementCursor() {
  const binding = Array.from(new TextEncoder().encode(JSON.stringify("reviewer-management-v1")),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `2026-10-01 13:45:21.123456+00~${assignmentId}~${binding}`;
}

function reviewerCandidateCursor(query: string, name: string) {
  const binding = Array.from(new TextEncoder().encode(JSON.stringify([
    "reviewer-candidates-v1", assignmentId, query,
  ])), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${encodeURIComponent(name).replace(/~/g, "%7E")}~${assignmentId}~${binding}`;
}

test("management list pagination is bounded, strict, and rejects stale or malformed cursors", () => {
  const base = `https://nova.test/api/task-assignments/reviewer-management`;
  expect(parseReviewerManagementPage(new Request(base))).toEqual({
    limit: 25, cursorAssignedAt: null, cursorAssignmentId: null,
  });
  expect(parseReviewerManagementPage(new Request(`${base}?limit=50&cursor=${encodeURIComponent(reviewerManagementCursor())}`)))
    .toEqual({ limit: 50, cursorAssignedAt: "2026-10-01 13:45:21.123456+00", cursorAssignmentId: assignmentId });
  for (const query of [
    "?limit=0", "?limit=51", "?limit=1.5", "?limit=25&limit=26",
    "?cursor=bad", `?cursor=${encodeURIComponent("2026-02-30 13:45:21.123456+00~" + assignmentId + "~00")}`,
    `?cursor=${encodeURIComponent("2026-10-01 13:45:21.123456+00~" + assignmentId + "~00")}`,
  ]) {
    expect(parseReviewerManagementPage(new Request(base + query))).toBeUndefined();
  }
});

test("reviewer candidate pagination binds the cursor to its assignment and search query", () => {
  const base = `https://nova.test/api/task-assignments/${assignmentId}/reviewer-management`;
  expect(parseReviewerCandidatePage(new Request(base), assignmentId)).toMatchObject({
    limit: 25, query: "", searchPattern: null, cursorName: null, cursorPersonId: null,
  });
  const name = "Aman ~ O'Neil";
  const cursor = reviewerCandidateCursor("Aman", name);
  expect(parseReviewerCandidatePage(
    new Request(`${base}?q=Aman&cursor=${encodeURIComponent(cursor)}`), assignmentId,
  )).toMatchObject({ limit: 25, query: "Aman", cursorName: name, cursorPersonId: assignmentId });
  expect(parseReviewerCandidatePage(new Request(`${base}?q=Other&cursor=${encodeURIComponent(cursor)}`), assignmentId)).toBeUndefined();
  expect(parseReviewerCandidatePage(new Request(`${base}?limit=51`), assignmentId)).toBeUndefined();
  expect(parseReviewerCandidatePage(new Request(`${base}?q=${"x".repeat(101)}`), assignmentId)).toBeUndefined();
  expect(parseReviewerCandidatePage(new Request(`${base}?q=x&q=y`), assignmentId)).toBeUndefined();
  expect(parseReviewerCandidatePage(new Request(`${base}?cursor=%E0%A4%A`), assignmentId)).toBeUndefined();
});

test("list authorization is per exact task target and assigned_work cannot manage a coworker's row", () => {
  const sql = reviewerManagementListReadSql.toUpperCase();
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'TASKS.REVIEWER_MANAGE'");
  expect(sql).toContain("GRANTS.SCOPE = ANY(ARRAY['ORGANISATION', 'CLIENT_WORKSTREAM', 'GROUP', 'ASSIGNED_WORK']::NOVA.PERMISSION_SCOPE[])");
  expect(sql).toContain("GRANTS.CLIENT_ID = CLIENTS.ID");
  expect(sql).toContain("GRANTS.CLIENT_WORKSTREAM_ID = TASKS.CLIENT_WORKSTREAM_ID");
  expect(sql).toContain("GRANTS.GROUP_ID = TASKS.WORK_GROUP_ID");
  expect(sql).toContain("ROLES.ORGANISATION_ID = $2");
  expect(sql).toContain("ACTOR_ASSIGNMENTS.ID = ASSIGNMENTS.ID");
  expect(sql).toContain("ACTOR_ASSIGNMENTS.PERSON_ID = $1");
  expect(sql).toContain("ASSIGNMENTS.ORGANISATION_ID = $2");
  const scope = sql.indexOf("GRANTS.PERMISSION_KEY = 'TASKS.REVIEWER_MANAGE'");
  const cursor = sql.indexOf("$3::TIMESTAMPTZ IS NULL");
  const order = sql.indexOf("ORDER BY ASSIGNMENTS.ASSIGNED_AT DESC");
  const limit = sql.indexOf("LIMIT $5");
  expect(scope).toBeGreaterThan(-1);
  expect(scope).toBeLessThan(cursor);
  expect(cursor).toBeLessThan(order);
  expect(order).toBeLessThan(limit);
  expect(sql).not.toContain("TASKS.ASSIGN");
  expect(sql).not.toContain("TASKS.REASSIGN");
  expect(sql).not.toContain("EMAIL");
});

test("focused authorization uses exact client/workstream/group and the assignment id for assigned_work", () => {
  const sql = reviewerManagementFocusedReadSql.toUpperCase();
  expect(sql).toContain("ASSIGNMENTS.ID = $3");
  expect(sql).toContain("GRANTS.CLIENT_ID = CLIENTS.ID");
  expect(sql).toContain("GRANTS.CLIENT_WORKSTREAM_ID = TASKS.CLIENT_WORKSTREAM_ID");
  expect(sql).toContain("GRANTS.GROUP_ID = TASKS.WORK_GROUP_ID");
  expect(sql).toContain("ROLES.ORGANISATION_ID = $2");
  expect(sql).toContain("ACTOR_ASSIGNMENTS.ID = ASSIGNMENTS.ID");
  expect(sql).toContain("AS PERMITTED");
  expect(sql).not.toContain("EMAIL");
});

test("normal reviewer candidate SQL scopes eligible people before keyset pagination", () => {
  const sql = reviewerEligibleCandidatesReadSql.toUpperCase();
  expect(sql).toContain("STATUSES.STATUS IN ('ACTIVE', 'NOTICE')");
  expect(sql).toContain("PEOPLE.ID <> $2");
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'TASKS.REVIEW'");
  expect(sql).toContain("ROLES.ORGANISATION_ID = $1");
  expect(sql).toContain("GRANTS.CLIENT_ID = $3::UUID");
  expect(sql).toContain("GRANTS.CLIENT_WORKSTREAM_ID = $4::UUID");
  expect(sql).toContain("GRANTS.GROUP_ID = $5::UUID");
  expect(sql).toContain("GRANTS.SCOPE = 'ASSIGNED_WORK' AND EXISTS");
  const earlySearch = sql.indexOf("PEOPLE.DISPLAY_NAME ILIKE $7 ESCAPE '^'");
  const grantWork = sql.indexOf("CANDIDATE_ACTIVE_GRANTS AS MATERIALIZED");
  const eligible = sql.indexOf("GRANTS.PERMISSION_KEY = 'TASKS.REVIEW'");
  const cursor = sql.indexOf("$8::TEXT IS NULL");
  const order = sql.indexOf("ORDER BY CANDIDATE_PEOPLE.DISPLAY_NAME COLLATE \"C\"");
  const limit = sql.indexOf("LIMIT $10");
  expect(eligible).toBeGreaterThan(-1);
  expect(earlySearch).toBeGreaterThan(-1);
  expect(earlySearch).toBeLessThan(grantWork);
  expect(eligible).toBeLessThan(cursor);
  expect(cursor).toBeLessThan(order);
  expect(order).toBeLessThan(limit);
  expect(sql).not.toContain("EMAIL");
});

test("exception candidates are a separate active-staff projection, not reviewer-eligible candidates", () => {
  const sql = reviewerExceptionCandidatesReadSql.toUpperCase();
  expect(sql).toContain("STATUSES.STATUS IN ('ACTIVE', 'NOTICE')");
  expect(sql).toContain("PEOPLE.ID <> $2");
  expect(sql).toContain("LIMIT $6");
  expect(sql).not.toContain("TASKS.REVIEW");
  expect(sql).not.toContain("EMAIL");
  expect(reviewerExceptionTargetReadSql.toUpperCase()).toContain("ASSIGNMENTS.REVIEW_REQUIRED");
});

test("ordinary reviewer-management DTO exposes only fields needed by its screen", () => {
  const projected = projectReviewerManagementAssignment({
    assignment_id: assignmentId,
    task_id: "8f7fda96-7352-4e96-9ce0-71c0de51f760",
    title: "Access review",
    assignment_status: "awaiting_review",
    review_required: true,
    review_blocked_reason: null,
    assignee_name: "Avery Active",
    reviewer_person_id: "7f7fda96-7352-4e96-9ce0-71c0de51f761",
    reviewer_name: "Morgan Reviewer",
    cursor_assigned_at: "2026-10-01 10:00:00.000000+00",
    permitted: true,
    client_id: "client-1",
    client_workstream_id: "workstream-1",
    work_group_id: "group-1",
    assignee_person_id: "assignee-1",
    email: "private@example.test",
  } as never);
  expect(projected).toEqual({
    assignmentId,
    taskTitle: "Access review",
    status: "awaiting_review",
    assigneeName: "Avery Active",
    reviewRequired: true,
    reviewBlockedReason: null,
    currentReviewer: { id: "7f7fda96-7352-4e96-9ce0-71c0de51f761", displayName: "Morgan Reviewer" },
  });
  expect(Object.keys(projected)).not.toContain("email");
  expect(Object.keys(projected)).not.toContain("taskId");
  expect(Object.keys(projected)).not.toContain("exception");
  expect(JSON.stringify(projected)).not.toContain("Temporary exception");
  expect(JSON.stringify(projected)).not.toContain("Super Admin");
  expect(reviewerManagementListReadSql.toLowerCase()).not.toContain("reviewer_exception");
  expect(reviewerManagementFocusedReadSql.toLowerCase()).not.toContain("reviewer_exception");
});
