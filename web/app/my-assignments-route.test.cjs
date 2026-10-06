const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const routeUrl = pathToFileURL(path.join(__dirname, "my-assignments-route.js"));

const assignment = (overrides = {}) => ({
  assignmentId: "assignment-1",
  taskId: "task-1",
  title: "Prepare report",
  canViewTask: true,
  status: "in_progress",
  dueDate: "2026-10-10",
  dueDateRevision: 4,
  canEditDueDate: true,
  canStart: false,
  canSubmit: true,
  canRequestReviewer: true,
  canRequestHandover: false,
  hasPendingReviewerRequest: false,
  hasPendingHandoverRequest: false,
  reviewRequired: true,
  billingClass: "billable",
  taskDefinition: { entryId: "definition-1", revision: 2 },
  correctionOf: null,
  secretProviderPayload: "must not reach React",
  ...overrides,
});

function routeHarness(overrides = {}) {
  let current = true;
  let mounted;
  const candidateCalls = [];
  const host = {
    isCurrentPageRequest: () => current,
    readIssue: (result) => result?.readError ? { message: "Assignments are unavailable." } : undefined,
    readAssignmentCandidates: async (id, lifetime) => {
      candidateCalls.push({ id, lifetime });
      return {
        reviewers: [{ id: "reviewer-1", display_name: "Rae Reviewer", privateValue: "strip" }],
        handoverTargets: [{ id: "person-2", display_name: "Sam Person" }],
      };
    },
    mountReactIsland: (...args) => { mounted = args; },
    ...overrides,
  };
  return {
    route: create(host),
    candidateCalls,
    get mounted() { return mounted; },
    setCurrent(value) { current = value; },
  };
}

let create;
let project;
test("load the ESM route adapter", async () => {
  ({ createMyAssignmentsRoute: create, projectMyAssignmentsRead: project } = await import(routeUrl.href));
});

test("projects only the documented Mine DTO and keeps server capability hints unchanged", () => {
  const read = project({ assignments: [assignment()], hasMore: true, nextCursor: "cursor-2", limit: 30 }, () => undefined);
  assert.equal(read.status, "ready");
  assert.deepEqual(read.data.assignments[0], {
    assignmentId: "assignment-1",
    taskId: "task-1",
    title: "Prepare report",
    canViewTask: true,
    status: "in_progress",
    dueDate: "2026-10-10",
    dueDateRevision: 4,
    canEditDueDate: true,
    canStart: false,
    canSubmit: true,
    canRequestReviewer: true,
    canRequestHandover: false,
    hasPendingReviewerRequest: false,
    hasPendingHandoverRequest: false,
    reviewRequired: true,
    billingClass: "billable",
    taskDefinition: { entryId: "definition-1", revision: 2 },
    correctionOf: null,
  });

  const notViewable = project({ assignments: [assignment({ canViewTask: false, billingClass: "billable" })] }, () => undefined);
  assert.equal(Object.hasOwn(notViewable.data.assignments[0], "billingClass"), false);
  assert.equal(notViewable.data.assignments[0].canSubmit, true);
  assert.equal(notViewable.data.limit, 30);
});

test("distinguishes denied and failed reads from malformed success and a true empty page", () => {
  const denied = project({ readError: "PERMISSION_DENIED" }, () => ({ message: "Not allowed." }));
  assert.deepEqual(denied, { status: "denied", message: "Not allowed." });
  const failed = project({ readError: "REQUEST_FAILED" }, () => ({ message: "Could not load." }));
  assert.deepEqual(failed, { status: "error", message: "Could not load." });
  const malformed = project({ assignments: null }, () => undefined);
  assert.equal(malformed.status, "error");
  assert.match(malformed.message, /your assignments/i);
  const malformedRow = project({ assignments: [assignment({ taskId: null })] }, () => undefined);
  assert.equal(malformedRow.status, "error");
  const empty = project({ assignments: [], hasMore: false, nextCursor: null, limit: 30 }, () => undefined);
  assert.deepEqual(empty, { status: "ready", data: { assignments: [], hasMore: false, nextCursor: null, limit: 30 } });
});

test("mounts only for the existing grant plan and a current host page lifetime", () => {
  const harness = routeHarness();
  const input = {
    authorized: true,
    target: {},
    lifetime: { id: "page-1" },
    Component: function MyAssignments() {},
    result: { assignments: [] },
    filters: { status: "all", due: "any", search: "", cursor: "" },
    callbacks: {},
  };
  assert.equal(harness.route({ ...input, authorized: false }), false);
  harness.setCurrent(false);
  assert.equal(harness.route(input), false);
  assert.equal(harness.mounted, undefined);
  assert.deepEqual(harness.candidateCalls, []);
});

test("wires candidate reads through the host lifetime, caches by assignment, and retries explicitly", async () => {
  const harness = routeHarness();
  const lifetime = { id: "page-2" };
  harness.route({
    authorized: true,
    target: {},
    lifetime,
    Component: function MyAssignments() {},
    result: { assignments: [] },
    filters: {},
    callbacks: {},
  });
  const props = harness.mounted[2];
  const row = assignment();
  const first = await props.onLoadCandidates(row);
  assert.deepEqual(first.reviewers, [{ id: "reviewer-1", displayName: "Rae Reviewer" }]);
  assert.deepEqual(first.handoverTargets, [{ id: "person-2", displayName: "Sam Person" }]);
  assert.equal(Object.hasOwn(first.reviewers[0], "privateValue"), false);
  await props.onLoadCandidates(row);
  assert.equal(harness.candidateCalls.length, 1);
  await props.onLoadCandidates(row, { retry: true });
  assert.equal(harness.candidateCalls.length, 2);
  assert.deepEqual(harness.candidateCalls[0], { id: "assignment-1", lifetime });
});

test("passes host actions, filters, saved views and history navigation through unchanged", () => {
  const harness = routeHarness();
  const callbacks = Object.fromEntries([
    "onApplyFilters", "onClearFilters", "onOpenTask", "onStart", "onSubmit",
    "onSaveDueDate", "onRequestReviewer", "onRequestHandover", "onOlder", "onNewer", "onRetry",
  ].map((name) => [name, () => name]));
  const filters = { status: "in_progress", due: "upcoming", search: "report", cursor: "cursor-3" };
  const savedViews = { component: "saved-views" };
  const taskDetailHref = (id) => "/task/" + id;
  harness.route({
    authorized: true,
    target: {},
    lifetime: { id: "page-3" },
    Component: function MyAssignments() {},
    result: { assignments: [] },
    filters,
    savedViews,
    focusHeading: true,
    taskDetailHref,
    callbacks,
  });
  const props = harness.mounted[2];
  assert.equal(props.filters, filters);
  assert.equal(props.savedViews, savedViews);
  assert.equal(props.taskDetailHref, taskDetailHref);
  assert.equal(props.focusHeading, true);
  for (const [name, callback] of Object.entries(callbacks)) assert.equal(props[name], callback, name);
});

test("candidate loading stops at the stale host boundary after mount", async () => {
  const harness = routeHarness();
  harness.route({
    authorized: true,
    target: {},
    lifetime: { id: "page-4" },
    Component: function MyAssignments() {},
    result: { assignments: [] },
    filters: {},
    callbacks: {},
  });
  harness.setCurrent(false);
  const read = await harness.mounted[2].onLoadCandidates(assignment());
  assert.equal(read.readError, "STALE_PAGE_REQUEST");
  assert.deepEqual(harness.candidateCalls, []);
});
