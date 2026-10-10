const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const readsSource = fs.readFileSync(path.join(__dirname, "work-read-route.js"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "work-reviews-route.js"), "utf8");

async function loadRoute() {
  return import("./work-reviews-route.js");
}

function makeReviewActionHost(overrides = {}) {
  const calls = { requests: [], cleared: [], messages: [], refreshes: 0, recoveries: [] };
  const behavior = {
    commandCurrent: true,
    identityCurrent: true,
    recoveryResult: false,
    writeError: null,
    ...overrides,
  };
  const host = {
    target: "review-root",
    api: async (path, options) => {
      calls.requests.push({ path, options });
      if (behavior.writeError) throw behavior.writeError;
      return {};
    },
    requestOptions: (method, body) => ({ method, body }),
    captureCommandContext: (target) => ({ target }),
    isCurrentCommand: () => behavior.commandCurrent,
    isCurrentCommandIdentity: () => behavior.identityCurrent,
    recoverProtectedCommandFailure: (error, context, message) => {
      calls.recoveries.push({ error, context, message });
      return behavior.recoveryResult;
    },
    clearDraft: (assignmentId) => calls.cleared.push(assignmentId),
    setMessage: (...message) => calls.messages.push(message),
    errorText: (error) => `Safe: ${error.code}`,
    refreshWork: () => { calls.refreshes += 1; },
    openReviewContext: (assignmentId) => { calls.opened = assignmentId; },
    saveDraft: (assignmentId, draft) => { calls.draft = [assignmentId, draft]; },
  };
  return { host: { ...host, ...overrides.host }, behavior, calls };
}

function readIssue(result, resource) {
  if (!result?.readError) return undefined;
  return { message: `${resource}: ${result.readError}` };
}

const actions = {
  onOpenContext() {},
  onApprove() {},
  onRequestChanges() {},
  onDraftChange() {},
  onRetryQueue() {},
  onRetryContext() {},
};

test("projects a safe pending-review queue with host action hints and drafts", async () => {
  const { projectWorkReviews } = await loadRoute();
  const draft = { sourceReviewCycleId: "cycle-1", acknowledgedReviewCycleId: null, feedback: "Please clarify." };
  const projection = projectWorkReviews({
    reviewsResult: { reviews: [{
      assignmentId: "assignment-1",
      title: "Prepare the delivery brief",
      reviewCycleId: "cycle-1",
      cycleNumber: 2,
      submittedAt: "2026-10-02T10:00:00.000Z",
      privatePersonId: "private-person",
    }] },
    hasReviewRoute: false,
    readIssue,
    canDecide: () => true,
    readDraft: () => draft,
  });

  assert.deepEqual(projection.queue, {
    status: "ready",
    reviews: [{
      assignmentId: "assignment-1",
      title: "Prepare the delivery brief",
      reviewCycleId: "cycle-1",
      cycleNumber: 2,
      submittedAt: "2026-10-02T10:00:00.000Z",
      canDecide: true,
      draft,
    }],
    requestLimit: 100,
  });
  assert.equal(projection.reviewReadFailed, false);
  assert.equal("context" in projection, false);
  assert.equal(JSON.stringify(projection).includes("private-person"), false);
});

test("preserves empty, denied, and error queue states", async () => {
  const { projectWorkReviews } = await loadRoute();
  const base = { readIssue, hasReviewRoute: false };

  assert.deepEqual(projectWorkReviews({ ...base, reviewsResult: { reviews: [] } }).queue, { status: "empty" });
  assert.deepEqual(projectWorkReviews({
    ...base,
    reviewsResult: { readError: "PERMISSION_DENIED" },
  }).queue, { status: "denied", message: "pending reviews: PERMISSION_DENIED" });
  assert.deepEqual(projectWorkReviews({
    ...base,
    reviewsResult: { readError: "REQUEST_FAILED" },
  }).queue, { status: "error", message: "pending reviews: REQUEST_FAILED" });
});

test("projects exact review context and history fields and preserves focused assignment", async () => {
  const { projectWorkReviews } = await loadRoute();
  const projection = projectWorkReviews({
    reviewsResult: { reviews: [{ assignmentId: "assignment-1" }] },
    reviewDetailResult: {
      review: {
        assignee: { displayName: "A. Person", email: "omit@example.test" },
        task: { title: "Task", description: "Details", status: "submitted", priority: "high", dueDate: "2026-10-10" },
        client: { name: "Client" },
        workstream: { name: "Workstream" },
        group: { name: "Group" },
        submittedAt: "2026-10-02T10:00:00.000Z",
      },
      history: [{
        reviewCycleId: "cycle-1", cycleNumber: 1, decision: "changes_requested",
        submittedAt: "2026-10-01T10:00:00.000Z", decidedAt: "2026-10-01T11:00:00.000Z",
        feedback: "Clarify this.", isCurrent: true, privateMeta: "omit",
      }],
      historyTruncated: true,
    },
    hasReviewRoute: true,
    selectedReview: { assignmentId: "assignment-1" },
    readIssue,
    canDecide: () => true,
  });

  assert.deepEqual(projection.context, {
    status: "ready",
    detail: {
      review: {
        assigneeName: "A. Person",
        taskTitle: "Task",
        taskDescription: "Details",
        taskStatus: "submitted",
        priority: "high",
        dueDate: "2026-10-10",
        clientName: "Client",
        workstreamName: "Workstream",
        groupName: "Group",
        submittedAt: "2026-10-02T10:00:00.000Z",
      },
      history: [{
        reviewCycleId: "cycle-1", cycleNumber: 1, decision: "changes_requested",
        submittedAt: "2026-10-01T10:00:00.000Z", decidedAt: "2026-10-01T11:00:00.000Z",
        feedback: "Clarify this.", isCurrent: true,
      }],
      historyTruncated: true,
    },
  });
  assert.equal(projection.focusAssignmentId, "assignment-1");
  assert.equal(JSON.stringify(projection).includes("omit@example.test"), false);
  assert.equal(JSON.stringify(projection).includes("privateMeta"), false);
});

test("preserves unavailable, denied, and error context states and suppresses focus after queue failure", async () => {
  const { projectWorkReviews } = await loadRoute();
  const base = {
    reviewsResult: { readError: "REQUEST_FAILED" },
    hasReviewRoute: true,
    selectedReview: { assignmentId: "assignment-1" },
    readIssue,
  };

  const absent = projectWorkReviews({ ...base, reviewDetailResult: undefined });
  assert.deepEqual(absent.context, {
    status: "unavailable",
    message: "This review is no longer open to you or is outside your current access.",
  });
  assert.equal(absent.focusAssignmentId, undefined);

  assert.deepEqual(projectWorkReviews({
    ...base,
    reviewsResult: { reviews: [] },
    reviewDetailResult: { readError: "REVIEW_NOT_OPEN" },
  }).context, { status: "unavailable", message: "review context: REVIEW_NOT_OPEN" });
  assert.deepEqual(projectWorkReviews({
    ...base,
    reviewsResult: { reviews: [] },
    reviewDetailResult: { readError: "PERMISSION_DENIED" },
  }).context, { status: "denied", message: "review context: PERMISSION_DENIED" });
  assert.deepEqual(projectWorkReviews({
    ...base,
    reviewsResult: { reviews: [] },
    reviewDetailResult: { readError: "REQUEST_FAILED" },
  }).context, { status: "error", message: "review context: REQUEST_FAILED" });
});

test("mounts projected props with host actions or retains the import fallback copy", async () => {
  const { mountWorkReviewsRoute } = await loadRoute();
  const mounted = [];
  const failures = [];
  const host = {
    mountReactIsland: (...args) => mounted.push(args),
    showWorkFeatureMessage: (...args) => failures.push(args),
  };
  const projection = { queue: { status: "empty" }, reviewReadFailed: false };
  const component = function ReviewsPage() {};

  assert.deepEqual(mountWorkReviewsRoute("review-root", {
    feature: { ReviewsPage: component }, projection, actions,
  }, host), { mounted: true, reviewReadFailed: false });
  assert.equal(mounted[0][0], "review-root");
  assert.equal(mounted[0][1], component);
  assert.deepEqual(mounted[0][2], { queue: projection.queue, focusAssignmentId: undefined, ...actions });

  mountWorkReviewsRoute("review-root", { feature: null, loadError: new Error("chunk"), projection, actions }, host);
  mountWorkReviewsRoute("review-root", { feature: null, projection, actions }, host);
  assert.deepEqual(failures, [
    ["review-root", "Reviews are unavailable", "The review interface could not load. Refresh the page to try again."],
    ["review-root", "Reviews are unavailable", "The review interface is unavailable."],
  ]);
});

test("binds review actions to the host API and preserves expected-cycle payloads", async () => {
  const { createWorkReviewActions } = await loadRoute();
  const { host, calls } = makeReviewActionHost();
  const actions = createWorkReviewActions(host);
  const review = { assignmentId: "assignment-1", reviewCycleId: "cycle-4" };

  await actions.onApprove(review);
  assert.deepEqual(calls.requests[0], {
    path: "/api/task-assignments/assignment-1/review",
    options: { method: "POST", body: {
      decision: "approved", expectedReviewCycleId: "cycle-4", feedback: null,
    } },
  });
  assert.deepEqual(calls.cleared, ["assignment-1"]);
  assert.deepEqual(calls.messages, [["Work approved."]]);
  assert.equal(calls.refreshes, 1);

  await actions.onRequestChanges(review, "Clarify the outcome.");
  assert.deepEqual(calls.requests[1].options.body, {
    decision: "changes_requested", expectedReviewCycleId: "cycle-4", feedback: "Clarify the outcome.",
  });
  assert.deepEqual(calls.messages[1], ["Changes requested. The note is saved in review history and sent to the assignee."]);
});

test("preserves stale-cycle recovery and protected-command guards", async () => {
  const { createWorkReviewActions } = await loadRoute();
  const stale = makeReviewActionHost({
    writeError: Object.assign(new Error("stale"), { code: "REVIEW_CYCLE_STALE" }),
  });
  const staleActions = createWorkReviewActions(stale.host);
  await staleActions.onRequestChanges({ assignmentId: "assignment-1", reviewCycleId: "cycle-old" }, "Note");
  assert.deepEqual(stale.calls.messages, [["Safe: REVIEW_CYCLE_STALE", "warning"]]);
  assert.equal(stale.calls.refreshes, 1);
  assert.deepEqual(stale.calls.cleared, []);

  const denied = makeReviewActionHost({
    writeError: Object.assign(new Error("denied"), { code: "PERMISSION_DENIED", httpStatus: 403 }),
    recoveryResult: true,
  });
  await createWorkReviewActions(denied.host).onApprove({ assignmentId: "assignment-2", reviewCycleId: "cycle-2" });
  assert.deepEqual(denied.calls.cleared, ["assignment-2"]);
  assert.equal(denied.calls.recoveries.length, 1);
  assert.equal(denied.calls.messages.length, 0);
  assert.equal(denied.calls.refreshes, 0);

  const staleCommand = makeReviewActionHost({ commandCurrent: false });
  await createWorkReviewActions(staleCommand.host).onApprove({ assignmentId: "assignment-3", reviewCycleId: "cycle-3" });
  assert.deepEqual(staleCommand.calls.cleared, ["assignment-3"]);
  assert.equal(staleCommand.calls.messages.length, 0);
  assert.equal(staleCommand.calls.refreshes, 0);

  const identityChanged = makeReviewActionHost();
  identityChanged.host.api = async (path, options) => {
    identityChanged.calls.requests.push({ path, options });
    identityChanged.behavior.identityCurrent = false;
    identityChanged.behavior.commandCurrent = false;
    return {};
  };
  await createWorkReviewActions(identityChanged.host).onApprove({ assignmentId: "assignment-4", reviewCycleId: "cycle-4" });
  assert.deepEqual(identityChanged.calls.cleared, []);
  assert.equal(identityChanged.calls.messages.length, 0);
  assert.equal(identityChanged.calls.refreshes, 0);
});

test("keeps review planning in app.js and command behavior in the host adapter", () => {
  const appImports = appSource.split("async function renderWork(")[0];
  assert.match(appImports, /import\s*\{[^}]*\bcanRenderRequestReviewActions\b[^}]*\}\s*from ["']\.\/review-actions\.js["']/s,
    "the Work host imports the row-level review permission projector before mounting reviews");
  assert.match(appSource, /if \(readPlan\.reviews && !hasFocusedCollaborationRoute\) \{[\s\S]{0,300}projectWorkReviews\(/);
  assert.match(readsSource, /read\(readPlan\.reviews && !focusRequest,[\s\S]*?pendingReviewsReadUrl\(reviewTarget \|\| \{\}\)/);
  assert.match(appSource, /readWorkRouteData\(\{[\s\S]*?hasReviewRoute,[\s\S]*?focusRequest,[\s\S]*?pageApi,/);
  assert.match(appSource, /selectedReview && readPlan\.reviews[\s\S]{0,180}\/review/);
  assert.match(appSource, /createWorkReviewActions\(\{/);
  assert.match(appSource, /openReviewContext: \(assignmentId\) => openReviewAssignment\(assignmentId\)/);
  assert.match(appSource, /saveDraft: \(assignmentId, draft\) => \{\s*const taskId = \(Array\.isArray\(reviewsResult\?\.reviews\) \? reviewsResult\.reviews : \[\]\)\s*\.find\(\(review\) => review\?\.assignmentId === assignmentId\)\?\.taskId;\s*saveReviewFeedbackDraft\(assignmentId, draft, taskId\);/);
  assert.match(routeSource, /captureCommandContext\(target\)/);
  assert.match(routeSource, /expectedReviewCycleId: review\.reviewCycleId/);
  assert.match(routeSource, /"\/api\/task-assignments\/" \+ encodeURIComponent\(review\.assignmentId\) \+ "\/review"/);
  assert.match(routeSource, /recoverProtectedCommandFailure\(error, context, "Your review access changed/);
  assert.doesNotMatch(appSource, /onApprove: async \(review\)/);
  assert.doesNotMatch(appSource, /onRequestChanges: async \(review, feedback\)/);
});
