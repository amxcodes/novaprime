const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  isPendingReviewRoute,
  isUuid,
  pendingReviewsReadUrl,
  readFocusedCollaborationRequest,
  resolveWorkRouteContext,
  taskDetailUrl,
  visibleTaskFilters,
  visibleTaskReadUrl,
  workAssignmentFilters,
  workAssignmentReadUrl,
  workCollaborationReadUrl,
} = require("./work-route.js");

const reviewerId = "11111111-1111-4111-8111-111111111111";
const handoverId = "22222222-2222-4222-8222-222222222222";

test("Work route context derives focused modes and lazy feature imports from host permissions", () => {
  const allReads = {
    taskDetail: true,
    workContextView: true,
    reviews: true,
    reviewerRequests: true,
    handoverRequests: true,
    sessions: true,
    timeline: true,
    attendance: true,
    assignments: true,
    taskCollection: true,
    reviewerManagement: true,
  };
  const review = resolveWorkRouteContext({
    searchParams: new URLSearchParams(`view=work&review=${reviewerId}`),
    readPlan: allReads,
    canCreateTasks: true,
    canActOnTasks: true,
  });
  assert.equal(review.workPageTitle, "Pending review");
  assert.equal(review.validReviewTarget, true);
  assert.deepEqual(review.featureImports, {
    taskDetail: false,
    workContext: false,
    reviews: true,
    collaboration: false,
    taskComposer: false,
    sessions: false,
    timeline: false,
    assignments: false,
    savedTaskViews: false,
    visibleTasks: false,
    reviewerManagement: false,
  });

  const collaboration = resolveWorkRouteContext({
    searchParams: new URLSearchParams(`view=work&reviewerRequest=${reviewerId}`),
    readPlan: allReads,
    canCreateTasks: true,
    canActOnTasks: true,
  });
  assert.equal(collaboration.workPageTitle, "Collaboration request");
  assert.equal(collaboration.focusRequest.kind, "reviewer");
  assert.equal(collaboration.featureImports.collaboration, true);
  assert.equal(collaboration.featureImports.reviews, false);
  assert.equal(collaboration.featureImports.taskComposer, false);
  assert.equal(collaboration.featureImports.assignments, false);
  assert.equal(collaboration.featureImports.visibleTasks, false);

  const taskDetail = resolveWorkRouteContext({
    searchParams: new URLSearchParams("view=work&task=task-1"),
    readPlan: allReads,
    canCreateTasks: true,
  });
  assert.equal(taskDetail.taskDetailRoute, true);
  assert.equal(taskDetail.workPageTitle, "Task details");
  assert.equal(taskDetail.featureImports.taskDetail, true);
  assert.equal(taskDetail.featureImports.taskComposer, false);
  assert.equal(taskDetail.featureImports.workContext, false);

  const groupOnlyCreator = resolveWorkRouteContext({
    searchParams: new URLSearchParams("view=work"),
    readPlan: { workContextView: false, taskCatalog: true },
    canCreateTasks: true,
  });
  assert.equal(groupOnlyCreator.workDescription, "Create tasks in workstreams available under your access.");
  assert.equal(groupOnlyCreator.featureImports.taskComposer, true);
  assert.equal(groupOnlyCreator.featureImports.taskDetail, false);
});

test("Work route context rejects an invalid focused collaboration route without importing unrelated features", () => {
  const route = resolveWorkRouteContext({
    searchParams: new URLSearchParams("view=work&reviewerRequest=not-a-uuid"),
    readPlan: { taskCollection: true, assignments: true, reviewerRequests: true },
    canCreateTasks: true,
  });
  assert.deepEqual(route.focusedCollaboration, { status: "invalid" });
  assert.equal(route.focusRequest, null);
  assert.equal(route.hasFocusedCollaborationRoute, false);
  assert.deepEqual(route.featureImports, {
    taskDetail: false,
    workContext: false,
    reviews: false,
    collaboration: false,
    taskComposer: false,
    sessions: false,
    timeline: false,
    assignments: false,
    savedTaskViews: false,
    visibleTasks: false,
    reviewerManagement: false,
  });
  assert.equal(isUuid(reviewerId), true);
  assert.equal(isUuid("task-1"), false);
});

test("typed request destinations select exactly one request read", () => {
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams(`reviewerRequest=${reviewerId}`)), {
    status: "focused", kind: "reviewer", id: reviewerId,
  });
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams(`handoverRequest=${handoverId}`)), {
    status: "focused", kind: "handover", id: handoverId,
  });
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams()), { status: "none" });
});

test("malformed, duplicated, and mixed request targets fail closed", () => {
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams("reviewerRequest=not-an-id")), { status: "invalid" });
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams(`reviewerRequest=${reviewerId}&reviewerRequest=${handoverId}`)), { status: "invalid" });
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams(`reviewerRequest=${reviewerId}&handoverRequest=${handoverId}`)), { status: "invalid" });
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams(`reviewerRequest=${reviewerId}&task=task-1`)), { status: "invalid" });
  assert.deepEqual(readFocusedCollaborationRequest(new URLSearchParams(`handoverRequest=${handoverId}&review=assignment-1`)), { status: "invalid" });
});

test("request reads carry only the exact optional ID filter", () => {
  assert.equal(workCollaborationReadUrl("reviewer"), "/api/task-reviewer-requests");
  assert.equal(workCollaborationReadUrl("handover", handoverId), `/api/task-handover-requests?requestId=${handoverId}`);
  assert.throws(() => workCollaborationReadUrl("reviewer", "bad id"), /Invalid collaboration request ID/);
});

test("task detail links preserve only the approved filters from the current Work route", () => {
  const current = new URLSearchParams(
    "view=work&assignmentStatus=late&assignmentSearch=handoff+%26+review&taskStatus=blocked&taskLayout=board&person=secret&task=old",
  );
  const url = new URL(taskDetailUrl("task / 7", current), "https://nova.test");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("view"), "work");
  assert.equal(url.searchParams.get("task"), "task / 7");
  assert.equal(url.searchParams.get("assignmentStatus"), "late");
  assert.equal(url.searchParams.get("assignmentSearch"), "handoff & review");
  assert.equal(url.searchParams.get("taskStatus"), "blocked");
  assert.equal(url.searchParams.get("taskLayout"), "board");
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "assignmentSearch", "assignmentStatus", "task", "taskLayout", "taskStatus", "view",
  ]);

  const outsideWork = new URL(taskDetailUrl("task-8", new URLSearchParams("view=people&taskStatus=done")), "https://nova.test");
  assert.deepEqual([...outsideWork.searchParams.entries()], [["view", "work"], ["task", "task-8"]]);
});

test("assignment filters map query names and omit default values from bounded reads", () => {
  assert.deepEqual(workAssignmentFilters(new URLSearchParams()), {
    status: "all", due: "any", search: "", cursor: "",
  });
  assert.equal(workAssignmentReadUrl(workAssignmentFilters(new URLSearchParams())),
    "/api/work/assignments/mine?limit=30");
  const filters = workAssignmentFilters(new URLSearchParams(
    "assignmentStatus=late&assignmentDue=overdue&assignmentSearch=hello+world&assignmentCursor=next%2Fpage",
  ));
  assert.deepEqual(filters, { status: "late", due: "overdue", search: "hello world", cursor: "next/page" });
  const read = new URL(workAssignmentReadUrl(filters), "https://nova.test");
  assert.equal(read.searchParams.get("limit"), "30");
  assert.equal(read.searchParams.get("status"), "late");
  assert.equal(read.searchParams.get("due"), "overdue");
  assert.equal(read.searchParams.get("q"), "hello world");
  assert.equal(read.searchParams.get("cursor"), "next/page");
});

test("visible-task filters use their own defaults and encode search and cursor values", () => {
  assert.deepEqual(visibleTaskFilters(new URLSearchParams()), {
    status: "open", due: "any", search: "", cursor: "",
  });
  assert.equal(visibleTaskReadUrl(visibleTaskFilters(new URLSearchParams())),
    "/api/work/tasks/visible?limit=30");
  const filters = visibleTaskFilters(new URLSearchParams(
    "taskStatus=done&taskDue=today&taskSearch=client+review&taskCursor=cursor%3D2",
  ));
  assert.deepEqual(filters, { status: "done", due: "today", search: "client review", cursor: "cursor=2" });
  const read = new URL(visibleTaskReadUrl(filters), "https://nova.test");
  assert.equal(read.searchParams.get("limit"), "30");
  assert.equal(read.searchParams.get("status"), "done");
  assert.equal(read.searchParams.get("due"), "today");
  assert.equal(read.searchParams.get("q"), "client review");
  assert.equal(read.searchParams.get("cursor"), "cursor=2");
});

test("pending-review reads choose one exact target and omit an empty query", () => {
  assert.equal(pendingReviewsReadUrl(), "/api/reviews/pending");
  assert.equal(pendingReviewsReadUrl({ taskId: "task / 1" }), "/api/reviews/pending?taskId=task+%2F+1");
  assert.equal(pendingReviewsReadUrl({ assignmentId: "assignment-1", taskId: "ignored" }),
    "/api/reviews/pending?assignmentId=assignment-1");
});

test("task notification links are not misclassified as reviewer routes for narrow work capabilities", () => {
  assert.equal(isPendingReviewRoute({ taskId: "task-1", taskDetail: false, reviews: false }), false);
  assert.equal(isPendingReviewRoute({ taskId: "task-1", taskDetail: false, reviews: true }), true);
  assert.equal(isPendingReviewRoute({ reviewId: "assignment-1", taskDetail: false, reviews: false }), true);
  assert.equal(isPendingReviewRoute({ taskId: "task-1", taskDetail: true, reviews: false }), false);
});
