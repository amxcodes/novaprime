const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const routeSource = fs.readFileSync(path.join(__dirname, "work-reviewer-management-route.js"), "utf8");
const actionsSource = fs.readFileSync(path.join(__dirname, "work-reviewer-management-actions-route.ts"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

async function loadRoute() {
  return import("./work-reviewer-management-route.js");
}

function makeHost(overrides = {}) {
  const calls = { mounts: [], messages: [], reads: [] };
  const target = { isConnected: true };
  const component = function ReviewerManagement() {};
  const host = {
    isCurrentPageRequest: () => true,
    readPage: async (...args) => {
      calls.reads.push(args);
      return { assignments: [], hasMore: false, nextCursor: null, limit: 25 };
    },
    mountReactIsland: (...args) => calls.mounts.push(args),
    showWorkFeatureMessage: (...args) => calls.messages.push(args),
    ...overrides,
  };
  return { calls, component, host, target };
}

test("mounts the feature with the initial read and existing paged read contracts", async () => {
  const { mountWorkReviewerManagementRoute } = await loadRoute();
  const { calls, component, host, target } = makeHost();
  const lifetime = { page: 4 };
  const initialRead = { assignments: [{ id: "assignment-1" }], hasMore: true, nextCursor: "next" };
  const saveReviewer = async () => ({ status: "saved" });

  assert.deepEqual(mountWorkReviewerManagementRoute(target, {
    feature: { ReviewerManagement: component }, initialRead, lifetime, onSaveReviewer: saveReviewer,
  }, host), { mounted: true });
  assert.equal(calls.mounts.length, 1);
  assert.equal(calls.mounts[0][0], target);
  assert.equal(calls.mounts[0][1], component);
  assert.equal(calls.mounts[0][2].initialRead, initialRead);
  assert.equal(calls.mounts[0][2].onSaveReviewer, saveReviewer);

  const props = calls.mounts[0][2];
  assert.deepEqual(await props.onLoadAssignments(), { assignments: [], hasMore: false, nextCursor: null, limit: 25 });
  assert.deepEqual(await props.onLoadAssignments("cursor-2"), { assignments: [], hasMore: false, nextCursor: null, limit: 25 });
  assert.deepEqual(await props.onLoadCandidates("assignment/1", "Ada & Bob", "candidate-3"), {
    assignments: [], hasMore: false, nextCursor: null, limit: 25,
  });
  assert.deepEqual(calls.reads, [
    ["/api/task-assignments/reviewer-management?limit=25", lifetime, {
      assignments: [], hasMore: false, nextCursor: null, limit: 25,
    }],
    ["/api/task-assignments/reviewer-management?limit=25&cursor=cursor-2", lifetime, {
      assignments: [], hasMore: false, nextCursor: null, limit: 25,
    }],
    ["/api/task-assignments/assignment%2F1/reviewer-management?limit=25&q=Ada+%26+Bob&cursor=candidate-3", lifetime, {}],
  ]);
});

test("preserves permission read envelopes and returns stale-page results without transport", async () => {
  const { mountWorkReviewerManagementRoute } = await loadRoute();
  const denied = { readError: "PERMISSION_DENIED" };
  const permissionRequired = { readError: "PREREQUISITE_PERMISSION_REQUIRED" };
  const { calls, component, host, target } = makeHost({
    readPage: async (...args) => {
      calls.reads.push(args);
      return args[0].includes("/assignment-1/reviewer-management?") ? permissionRequired : denied;
    },
  });
  const propsLifetime = "request-8";
  mountWorkReviewerManagementRoute(target, {
    feature: { ReviewerManagement: component }, lifetime: propsLifetime, onSaveReviewer: async () => ({ status: "saved" }),
  }, host);
  const props = calls.mounts[0][2];
  assert.equal(await props.onLoadAssignments(), denied);
  assert.equal(await props.onLoadCandidates("assignment-1", "", null), permissionRequired);
  assert.equal(calls.reads.length, 2);

  target.isConnected = false;
  assert.deepEqual(await props.onLoadAssignments("next"), { readError: "STALE_PAGE_REQUEST" });
  assert.deepEqual(await props.onLoadCandidates("assignment-1", "A", "next"), { readError: "STALE_PAGE_REQUEST" });
  assert.equal(calls.reads.length, 2);
});

test("keeps the import failure fallback inside the reviewer section", async () => {
  const { mountWorkReviewerManagementRoute } = await loadRoute();
  const { calls, host, target } = makeHost();
  assert.deepEqual(mountWorkReviewerManagementRoute(target, {
    feature: null, loadError: new Error("chunk"),
  }, host), { mounted: false });
  mountWorkReviewerManagementRoute(target, { feature: null }, host);
  assert.deepEqual(calls.messages, [
    [target, "Reviewer management is unavailable", "The reviewer management interface could not load. Refresh Work to try again."],
    [target, "Reviewer management is unavailable", "The reviewer management interface is unavailable."],
  ]);
  assert.equal(calls.mounts.length, 0);
  assert.equal(calls.reads.length, 0);
});

test("keeps reads in the mount adapter and injects reviewer save authority from the host", () => {
  assert.match(routeSource, /host\.readPage\(/);
  assert.doesNotMatch(routeSource, /\bfetch\s*\(|\bapi\s*\(|requestOptions|hasAnyPermissionGrant|actorGrants|recoverProtectedCommandFailure/);
  assert.match(appSource, /if \(readPlan\.reviewerManagement && !taskDetailRoute && !hasReviewRoute && !hasFocusedCollaborationRoute\) \{[\s\S]*?mountWorkReviewerManagementRoute\(reviewerManagementRoot/);
  assert.match(appSource, /createWorkReviewerManagementSaveAction\(\{[\s\S]*?canManageReviewer: \(\) => hasAnyPermissionGrant\(state\.actorGrants, \["tasks\.reviewer_manage"\], reviewerManagementScopes\)/);
  assert.match(appSource, /mountWorkReviewerManagementRoute\(reviewerManagementRoot, \{[\s\S]*?onSaveReviewer,/);
  assert.match(appSource, /readPage: \(path, requestLifetime, fallback\) => readOrError\(pageApi\(path, requestLifetime\), fallback\)/);
  assert.match(actionsSource, /requestOptions\("PATCH", \{ reviewerPersonId \}\)/);
  assert.match(actionsSource, /recoverProtectedCommandFailure\(error, context, accessChangedMessage\)/);
  assert.match(actionsSource, /result as Record<string, unknown>/);
  assert.match(actionsSource, /assignmentId !== assignmentId/);
  assert.doesNotMatch(actionsSource, /hasAnyPermissionGrant|actorGrants|function mountWorkReviewerManagementRoute/);
});
