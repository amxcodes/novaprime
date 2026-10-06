const assert = require("node:assert/strict");
const { test } = require("node:test");

async function loadProjector() {
  return import("./work-collaboration-route.js");
}

const reviewed = {
  id: "request-1",
  assignment_id: "private-assignment-id",
  requester_person_id: "private-requester-id",
  candidate_reviewer_person_id: "private-candidate-id",
  request_kind: "replacement",
  reason: "Please review the updated work.",
  status: "pending",
  created_at: "2026-10-02T10:00:00.000Z",
  expires_at: "2026-10-09T10:00:00.000Z",
  resolved_at: null,
  title: "Prepare the delivery brief",
  task_id: "private-task-id",
  task_status: "active",
  isRecipient: true,
  canAccept: true,
  canDecline: true,
  canWithdraw: false,
  canReviewTarget: true,
  privateMeta: "omit",
};

const resolved = {
  ...reviewed,
  id: "request-2",
  request_kind: "initial",
  status: "accepted",
  resolved_at: "2026-10-02T11:00:00.000Z",
  isRecipient: false,
  canAccept: false,
  canDecline: false,
  canWithdraw: false,
};

test("collaboration reads keep pending and resolved safe presentation fields separate", async () => {
  const { projectWorkCollaborationReadState } = await loadProjector();
  const state = projectWorkCollaborationReadState(
    { requests: [reviewed, resolved] },
    "reviewer requests",
    () => {},
    () => null,
  );

  assert.equal(state.status, "ready");
  assert.equal(state.loadedRecordCount, 2);
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.requests[0], {
    id: "request-1",
    kind: "reviewer",
    requestKind: "replacement",
    status: "pending",
    title: "Prepare the delivery brief",
    reason: "Please review the updated work.",
    createdAt: "2026-10-02T10:00:00.000Z",
    expiresAt: "2026-10-09T10:00:00.000Z",
    resolvedAt: null,
    isRecipient: true,
    canAccept: true,
    canDecline: true,
    canWithdraw: false,
  });
  assert.deepEqual(state.history, [{
    id: "request-2",
    kind: "reviewer",
    requestKind: "initial",
    status: "accepted",
    title: "Prepare the delivery brief",
    reason: "Please review the updated work.",
    createdAt: "2026-10-02T10:00:00.000Z",
    expiresAt: "2026-10-09T10:00:00.000Z",
    resolvedAt: "2026-10-02T11:00:00.000Z",
    isRecipient: false,
    canAccept: false,
    canDecline: false,
    canWithdraw: false,
  }]);
  for (const forbidden of ["private-assignment-id", "private-requester-id", "private-candidate-id", "private-task-id", "active", "canReviewTarget", "privateMeta"]) {
    assert.equal(JSON.stringify(state).includes(forbidden), false, `must omit ${forbidden}`);
  }
});

test("handover requests receive only the handover kind and server-projected action flags", async () => {
  const { projectWorkCollaborationReadState } = await loadProjector();
  const state = projectWorkCollaborationReadState({ requests: [{
    ...reviewed,
    request_kind: undefined,
    target_person_id: "private-target-id",
    canAccept: false,
    canDecline: true,
    canWithdraw: true,
  }] }, "handover requests", undefined, () => null);

  assert.deepEqual(state.requests[0], {
    id: "request-1",
    kind: "handover",
    requestKind: "handover",
    status: "pending",
    title: "Prepare the delivery brief",
    reason: "Please review the updated work.",
    createdAt: "2026-10-02T10:00:00.000Z",
    expiresAt: "2026-10-09T10:00:00.000Z",
    resolvedAt: null,
    isRecipient: true,
    canAccept: false,
    canDecline: true,
    canWithdraw: true,
  });
  assert.equal(JSON.stringify(state).includes("private-target-id"), false);
});

test("denials, malformed envelopes, and invalid rows fail closed", async () => {
  const { projectWorkCollaborationReadState } = await loadProjector();
  const onRetry = () => {};
  const denial = projectWorkCollaborationReadState(
    { readError: "PERMISSION_DENIED" },
    "reviewer requests",
    onRetry,
    () => ({ message: "Not allowed." }),
  );
  assert.deepEqual(denial, { status: "denied", message: "Not allowed.", onRetry });

  const malformed = projectWorkCollaborationReadState({}, "handover requests", onRetry, () => null);
  assert.equal(malformed.status, "error");
  assert.equal(malformed.onRetry, onRetry);

  const invalidRow = projectWorkCollaborationReadState({ requests: [
    { ...reviewed, status: "unknown" },
    { ...reviewed, id: "missing-kind", request_kind: "unknown" },
  ] }, "reviewer requests", undefined, () => null);
  assert.equal(invalidRow.requests.length, 0);
  assert.equal(invalidRow.history.length, 0);
  assert.equal(invalidRow.loadedRecordCount, 2);
});
