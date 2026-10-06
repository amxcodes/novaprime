const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { planWorkReads } = require("../read-capabilities.ts");
const { createWorkPageSections } = require("../page-contracts.ts");
const {
  applyReviewerChange,
  canSaveReviewerSelection,
  projectReviewerManagementAssignment,
  projectReviewerManagementFocusedRead,
  projectReviewerManagementListRead,
} = require("./contracts.ts");
const { ReviewerManagement, reviewerSaveResultForError } = require("./ReviewerManagement.tsx");

const assignmentId = "00000000-0000-4000-8000-000000000001";
const assigneeId = "00000000-0000-4000-8000-000000000002";
const currentReviewerId = "00000000-0000-4000-8000-000000000003";
const candidateId = "00000000-0000-4000-8000-000000000004";

function assignment(overrides = {}) {
  return {
    assignmentId,
    taskId: "private-task-id",
    taskTitle: "Prepare the delivery brief",
    status: "submitted",
    assigneePersonId: assigneeId,
    assigneeName: "Aman Verma",
    assigneeEmail: "aman@example.test",
    reviewRequired: true,
    reviewBlockedReason: null,
    currentReviewer: { id: currentReviewerId, displayName: "Riya Shah", email: "riya@example.test" },
    exception: { reason: "Private exception note", grantedAt: "2026-10-01T10:00:00.000Z", grantedByName: "Owner" },
    ...overrides,
  };
}

function pageRead(rows = [assignment()]) {
  return { assignments: rows, hasMore: false, nextCursor: null, limit: 25 };
}

function render(initialRead) {
  return renderToStaticMarkup(React.createElement(ReviewerManagement, {
    initialRead,
    async onLoadAssignments() { return pageRead([]); },
    async onLoadCandidates() { return {}; },
    async onSaveReviewer() { return { status: "saved" }; },
  }));
}

test("the Work section stays hidden without the exact reviewer-management grant", () => {
  for (const read of [
    { grants: [] },
    { grants: [{ permissionKey: "tasks.assign", scope: "organisation" }] },
    { grants: [{ permissionKey: "tasks.reviewer_manage", scope: "client" }] },
  ]) {
    const reads = planWorkReads(read);
    assert.equal(reads.reviewerManagement, false);
    assert.equal(createWorkPageSections(reads, {
      canCreateTasks: false, hasReviewRoute: false, taskDetailRoute: false,
    }).some(({ id }) => id === "reviewer-management"), false);
  }
});

test("denied assignment reads present a permission state without exposing records or reviewer options", () => {
  const html = render({ error: "PERMISSION_DENIED" });
  assert.match(html, /Reviewer management is unavailable/);
  assert.match(html, /Refresh Work to check current access/);
  assert.doesNotMatch(html, /Prepare the delivery brief|Riya Shah|Choose reviewer|aman@example/);
});

test("assignment and candidate projections drop roster IDs, emails, and exception metadata", () => {
  const projected = projectReviewerManagementAssignment(assignment());
  assert.deepEqual(projected, {
    assignmentId,
    taskTitle: "Prepare the delivery brief",
    status: "submitted",
    assigneeName: "Aman Verma",
    reviewRequired: true,
    reviewBlockedReason: null,
    currentReviewer: { id: currentReviewerId, displayName: "Riya Shah" },
  });
  assert.equal(Object.hasOwn(projected, "taskId"), false);
  assert.equal(Object.hasOwn(projected, "exception"), false);

  const focused = projectReviewerManagementFocusedRead({
    assignment: assignment(),
    eligibleReviewers: {
      items: [{ id: candidateId, displayName: "Leena Rao", email: "leena@example.test", status: "active" }],
      hasMore: false, nextCursor: null, limit: 25,
    },
  });
  assert.equal(focused.status, "ready");
  assert.deepEqual(focused.data.eligibleReviewers.items, [{ id: candidateId, displayName: "Leena Rao" }]);
  assert.doesNotMatch(JSON.stringify(focused), /email|private-task-id|exception/);
});

test("API error envelopes classify real denied and stale states without exposing raw details", () => {
  assert.deepEqual(projectReviewerManagementListRead({ error: "PERMISSION_DENIED" }), {
    status: "denied",
    message: "You no longer have permission to view reviewer-managed assignments. Refresh Work to check current access.",
  });
  assert.equal(projectReviewerManagementFocusedRead({ error: "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE" }).status, "stale");
  assert.equal(projectReviewerManagementFocusedRead({ readError: "REVIEWER_CANDIDATE_QUERY_INVALID" }).status, "stale");
  assert.equal(projectReviewerManagementFocusedRead({ error: "SENSITIVE_SQL_DETAIL" }).status, "error");
  assert.doesNotMatch(JSON.stringify(projectReviewerManagementFocusedRead({ error: "SENSITIVE_SQL_DETAIL" })), /SENSITIVE_SQL_DETAIL/);
});

test("selection accepts only a loaded eligible reviewer and applies the confirmed reviewer change", () => {
  const current = projectReviewerManagementAssignment(assignment());
  const candidates = [{ id: candidateId, displayName: "Leena Rao" }];
  assert.equal(canSaveReviewerSelection(current, candidates, candidateId), true);
  assert.equal(canSaveReviewerSelection(current, candidates, currentReviewerId), false);
  assert.equal(canSaveReviewerSelection(current, candidates, "00000000-0000-4000-8000-000000000099"), false);
  assert.equal(canSaveReviewerSelection(current, candidates, ""), false);

  const changed = applyReviewerChange(current, candidates[0]);
  assert.equal(changed.currentReviewer.id, candidateId);
  assert.equal(changed.reviewRequired, true);
  assert.equal(changed.reviewBlockedReason, null);
  assert.equal(changed.assigneeName, current.assigneeName);
});

test("save failures map to denied/stale/error states and never appear confirmed", () => {
  assert.equal(reviewerSaveResultForError({ code: "PERMISSION_DENIED", httpStatus: 403 }).status, "denied");
  assert.equal(reviewerSaveResultForError({ code: "REVIEWER_NOT_ASSIGNABLE", httpStatus: 409 }).status, "stale");
  assert.equal(reviewerSaveResultForError({ code: "INTERNAL_ERROR", httpStatus: 500 }).status, "error");
  const html = render({
    assignments: [assignment()], hasMore: false, nextCursor: null, limit: 25,
  });
  assert.doesNotMatch(html, /Reviewer updated/);
});

test("invalid response sizes and terminal assignments fail closed", () => {
  assert.equal(projectReviewerManagementAssignment(assignment({ status: "approved" })), null);
  assert.equal(projectReviewerManagementListRead({
    assignments: Array.from({ length: 26 }, () => assignment()),
    hasMore: true, nextCursor: "cursor", limit: 25,
  }).status, "error");
  assert.equal(projectReviewerManagementListRead({
    assignments: [assignment()], hasMore: true, nextCursor: null, limit: 25,
  }).status, "error");
});

test("the route host keeps reviewer reads gated, paged, and separate from assignment writes", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../../../app.js"), "utf8");
  const start = app.indexOf("async function renderWork(");
  const end = app.indexOf("function workSetupPermission(", start);
  const route = app.slice(start, end);
  const routeContext = fs.readFileSync(path.join(__dirname, "../../../../app/work-route.js"), "utf8");
  const readsRoute = fs.readFileSync(path.join(__dirname, "../../../../app/work-read-route.js"), "utf8");
  const actionsRoute = fs.readFileSync(path.join(__dirname, "../../../../app/work-reviewer-management-actions-route.ts"), "utf8");
  assert.match(route, /resolveWorkRouteContext\(\{/);
  assert.match(routeContext, /reviewerManagement:\s*canLoadFeature\(readPlan\.reviewerManagement && standardFeatureRoute\)/);
  assert.match(route, /const reviewerManagementUi = loadedWorkRouteFeatures\.reviewerManagement\?\.module \|\| null/);
  assert.match(route, /reviewerManagementScopes = \["organisation", "client_workstream", "group", "assigned_work"\]/);
  assert.match(readsRoute, /read\(nonFocusedFeatureReads && readPlan\.reviewerManagement,[\s\S]*?"\/api\/task-assignments\/reviewer-management\?limit=25"/);
  assert.match(actionsRoute, /"\/api\/task-assignments\/" \+ encodeURIComponent\(assignmentId\) \+ "\/reviewer"[\s\S]*?requestOptions\("PATCH", \{ reviewerPersonId \}\)/);
  assert.match(actionsRoute, /result as Record<string, unknown>\)\.assignmentId !== assignmentId/);
  assert.doesNotMatch(route, /\/api\/people(?:\?|"|`)/);
});

test("candidate pagination keeps the applied search cursor and existing results on a page failure", () => {
  const source = fs.readFileSync(path.join(__dirname, "./ReviewerManagement.tsx"), "utf8");
  assert.match(source, /setFocusedQuery\(appliedQuery\)/);
  assert.match(source, /loadCandidates\(focusedId, focusedQuery, candidates\.nextCursor\)/);
  assert.match(source, /append && result\.status !== "ready" && previous\?\.status === "ready"[\s\S]*?setCandidatePageError\(result\.message\)/);
  assert.match(source, /append && previous\?\.status === "ready"[\s\S]*?setCandidatePageError\("Could not load more eligible reviewers/);
});

test("opening and closing reviewer management keep the panel linked and keyboard focus contextual", () => {
  const source = fs.readFileSync(path.join(__dirname, "./ReviewerManagement.tsx"), "utf8");
  assert.match(source, /aria-controls=\{active \? focusedPanelId : undefined\}/);
  assert.match(source, /<section id=\{focusedPanelId\}[\s\S]*?aria-labelledby=\{focusedHeadingId\}/);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?target\?\.scrollIntoView\(\{ block: "nearest" \}\);[\s\S]*?target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /function closeFocused\(\) \{\s*restoreTriggerId\.current = focusedId;/);
  assert.match(source, /const target = triggerId\s*\?\s*assignmentTriggers\.current\.get\(triggerId\) \?\? headingRef\.current\s*:\s*headingRef\.current/);
});

test("reviewer management IDs remain unique when the feature is composed more than once", () => {
  const props = {
    initialRead: pageRead(),
    onLoadAssignments: async () => pageRead([]),
    onLoadCandidates: async () => ({}),
    onSaveReviewer: async () => ({ status: "saved" }),
  };
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(ReviewerManagement, props),
    React.createElement(ReviewerManagement, props),
  ));
  const labels = [...markup.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
  const source = fs.readFileSync(path.join(__dirname, "./ReviewerManagement.tsx"), "utf8");

  assert.equal(labels.length, 2);
  assert.equal(new Set(labels).size, 2);
  assert.match(source, /const candidateSearchId = `\$\{focusedPanelId\}-candidate-search`/);
  assert.match(source, /id=\{candidateSearchId\}/);
});
