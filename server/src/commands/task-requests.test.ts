import { describe, expect, mock, test } from "bun:test";

mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));

const {
  assignmentCandidateOptionsSql,
  collaborationRequestNotificationTarget,
  handoverRequestsReadSql,
  handoverRequestActionFlags,
  parseAssignmentCandidateSearch,
  parseCollaborationRequestIdFilter,
  reviewerRequestsReadSql,
  reviewerRequestActionFlags,
} = await import("./task-requests.js");

const requestId = "00000000-0000-4000-8000-000000000001";

const actorId = "actor-1";
const requesterId = "requester-1";
const recipientId = actorId;

const reviewerRequest = (overrides: Partial<Parameters<typeof reviewerRequestActionFlags>[0]> = {}) =>
  reviewerRequestActionFlags({
    actorPersonId: actorId,
    requesterPersonId: requesterId,
    candidateReviewerPersonId: recipientId,
    requestStatus: "pending",
    expired: false,
    assignmentStatus: "assigned",
    taskStatus: "in_progress",
    canReviewTarget: true,
    ...overrides,
  });

const handoverRequest = (overrides: Partial<Parameters<typeof handoverRequestActionFlags>[0]> = {}) =>
  handoverRequestActionFlags({
    actorPersonId: actorId,
    requesterPersonId: requesterId,
    targetPersonId: recipientId,
    assignmentPersonId: requesterId,
    requestStatus: "pending",
    expired: false,
    assignmentStatus: "in_progress",
    taskStatus: "in_progress",
    canReceiveAssignments: true,
    canAcceptTarget: true,
    alreadyAssigned: false,
    ...overrides,
  });

test("exact request filters are optional, validated UUIDs, and reject duplicate parameters", () => {
  expect(parseCollaborationRequestIdFilter(new Request("https://nova.test/api/task-reviewer-requests"))).toBeNull();
  expect(parseCollaborationRequestIdFilter(new Request(
    `https://nova.test/api/task-reviewer-requests?requestId=${requestId}`,
  ))).toBe(requestId);

  for (const query of [
    "?requestId=",
    "?requestId=not-a-uuid",
    `?requestId=${requestId}&requestId=${requestId}`,
  ]) {
    expect(parseCollaborationRequestIdFilter(new Request(
      `https://nova.test/api/task-reviewer-requests${query}`,
    ))).toBeUndefined();
  }
});

test("assignment candidate search bounds input and rejects ambiguous q parameters", () => {
  const base = "https://nova.test/api/task-assignments/00000000-0000-4000-8000-000000000001/candidates";
  expect(parseAssignmentCandidateSearch(new Request(base))).toBe("");
  expect(parseAssignmentCandidateSearch(new Request(`${base}?q=%20Rae%20`))).toBe("Rae");
  expect(parseAssignmentCandidateSearch(new Request(`${base}?q=one&q=two`))).toBeUndefined();
  expect(parseAssignmentCandidateSearch(new Request(`${base}?q=${"x".repeat(101)}`))).toBeUndefined();
});

test("candidate picker query filters and bounds both lists in one permission-aware database projection", () => {
  const sql = assignmentCandidateOptionsSql().toLowerCase().replace(/\s+/g, " ");
  expect(sql).toContain("position($7 in lower(coalesce(people.display_name, ''))) > 0");
  expect(sql).toContain("candidate_active_grants");
  expect(sql).toContain("grants.person_id = candidate_people.id");
  expect(sql).toContain("'tasks.review'");
  expect(sql).toContain("policies.can_receive_assignments");
  expect(sql.match(/limit 100/g)).toHaveLength(2);
  expect(sql).not.toContain("select people.id, people.display_name from nova.people people");
});

test("exact reads retain organization and participant predicates before the bounded limit", () => {
  for (const [sql, participantColumn] of [
    [reviewerRequestsReadSql, "candidate_reviewer_person_id"],
    [handoverRequestsReadSql, "target_person_id"],
  ] as const) {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    const exactFilter = normalized.indexOf("and ($3::uuid is null or requests.id = $3)");
    const participantFilter = normalized.indexOf(
      `and (requests.requester_person_id = $2 or requests.${participantColumn} = $2)`,
    );
    const ordering = normalized.indexOf("order by requests.created_at desc");
    const limit = normalized.indexOf("limit 100");

    expect(normalized).toContain("where requests.organisation_id = $1");
    expect(exactFilter).toBeGreaterThan(-1);
    expect(participantFilter).toBeGreaterThan(exactFilter);
    expect(ordering).toBeGreaterThan(participantFilter);
    expect(limit).toBeGreaterThan(ordering);
  }
});

test("notification targets preserve exact request type and canonical deep link", () => {
  expect(collaborationRequestNotificationTarget("reviewer", requestId)).toEqual({
    aggregateType: "task_reviewer_request",
    aggregateId: requestId,
    deepLink: `/?view=work&reviewerRequest=${requestId}`,
  });
  expect(collaborationRequestNotificationTarget("handover", requestId)).toEqual({
    aggregateType: "task_handover_request",
    aggregateId: requestId,
    deepLink: `/?view=work&handoverRequest=${requestId}`,
  });
  expect(() => collaborationRequestNotificationTarget("reviewer", "bad-id")).toThrow(
    "COLLABORATION_REQUEST_ID_INVALID",
  );
});

describe("reviewer request action projection", () => {
  test("accept requires current review eligibility while recipient decline stays available", () => {
    expect(reviewerRequest({ canReviewTarget: false })).toEqual({
      canAccept: false,
      canDecline: true,
      canWithdraw: false,
    });
    expect(reviewerRequest()).toEqual({
      canAccept: true,
      canDecline: true,
      canWithdraw: false,
    });
  });

  test("only the requester can withdraw an open request", () => {
    expect(reviewerRequest({
      actorPersonId: requesterId,
      candidateReviewerPersonId: "other-recipient",
      canReviewTarget: false,
    })).toEqual({ canAccept: false, canDecline: false, canWithdraw: true });
  });

  test("closed, expired, cancelled, or approved requests expose no action", () => {
    const blocked = [
      { requestStatus: "accepted" },
      { expired: true },
      { assignmentStatus: "cancelled" },
      { assignmentStatus: "approved" },
      { taskStatus: "cancelled" },
    ] as const;
    for (const state of blocked) {
      expect(reviewerRequest(state)).toEqual({
        canAccept: false,
        canDecline: false,
        canWithdraw: false,
      });
    }
  });
});

describe("handover request action projection", () => {
  test("accept requires current target permission, assignment eligibility, and no duplicate assignment", () => {
    expect(handoverRequest()).toEqual({ canAccept: true, canDecline: true, canWithdraw: false });
    for (const restriction of [
      { canAcceptTarget: false },
      { canReceiveAssignments: false },
      { alreadyAssigned: true },
    ]) {
      expect(handoverRequest(restriction)).toEqual({
        canAccept: false,
        canDecline: true,
        canWithdraw: false,
      });
    }
  });

  test("only the requester can withdraw, and the active assignment must still belong to that requester", () => {
    expect(handoverRequest({
      actorPersonId: requesterId,
      targetPersonId: "other-target",
    })).toEqual({ canAccept: false, canDecline: false, canWithdraw: true });
    expect(handoverRequest({ assignmentPersonId: "someone-else" })).toEqual({
      canAccept: false,
      canDecline: false,
      canWithdraw: false,
    });
  });

  test("closed, expired, or non-handoverable requests expose no action", () => {
    const blocked = [
      { requestStatus: "declined" },
      { expired: true },
      { assignmentStatus: "awaiting_review" },
      { assignmentStatus: "cancelled" },
      { taskStatus: "cancelled" },
    ] as const;
    for (const state of blocked) {
      expect(handoverRequest(state)).toEqual({
        canAccept: false,
        canDecline: false,
        canWithdraw: false,
      });
    }
  });
});
