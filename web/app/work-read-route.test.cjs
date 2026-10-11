const assert = require("node:assert/strict");
const { test } = require("node:test");

async function loadRoute() {
  return import("./work-read-route.js");
}

const emptyPlan = () => ({
  assignments: false,
  sessions: false,
  timeline: false,
  reviews: false,
  reviewerRequests: false,
  handoverRequests: false,
  workContext: false,
  workContextView: false,
  taskDetail: false,
  taskCollection: false,
  taskCatalog: false,
  attendance: false,
  reviewerManagement: false,
});

function reader(overrides = {}) {
  const calls = [];
  const lifetime = { page: "work-7" };
  return {
    calls,
    lifetime,
    pageApi: async (path, receivedLifetime, options) => {
      calls.push({ path, lifetime: receivedLifetime, options });
      if (overrides.pageApi) return overrides.pageApi(path, receivedLifetime, options);
      if (path === "/api/work/page-read") {
        return {
          reads: options.body.reads.map((readPath) => ({
            path: readPath,
            status: 200,
            body: { path: readPath, allowed: true },
          })),
        };
      }
      return { path, allowed: true };
    },
  };
}

test("the default area dispatches only bounded My work reads from the authorized plan", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader();
  const searchParams = new URLSearchParams("assignmentStatus=late&assignmentDue=overdue&assignmentSearch=client+review&assignmentCursor=next%2Fpage");
  const readPlan = Object.fromEntries(Object.keys(emptyPlan()).map((key) => [key, true]));

  await readWorkRouteData({
    readPlan,
    date: "2026-10-06",
    searchParams,
    lifetime: host.lifetime,
    pageApi: host.pageApi,
  });

  assert.deepEqual(host.calls.map(({ path }) => path).sort(), [
    "/api/work/page-read", "/api/work-sessions/mine",
  ].sort());
  const batchCall = host.calls.find(({ path }) => path === "/api/work/page-read");
  assert.deepEqual(batchCall.options.body.reads, [
    "/api/work/assignments/mine?limit=30&status=late&due=overdue&q=client+review&cursor=next%2Fpage",
    "/api/work/timeline?date=2026-10-06",
    "/api/attendance/today",
  ]);
  assert.ok(host.calls.every((call) => call.lifetime === host.lifetime));
});

test("group-only task creation loads only its authorized context and catalog choices", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader();
  const readPlan = {
    ...emptyPlan(),
    workContext: true,
    taskCatalog: true,
  };
  const result = await readWorkRouteData({ readPlan, canCreateTasks: true, lifetime: host.lifetime, pageApi: host.pageApi });

  assert.deepEqual(host.calls.map(({ path }) => path), ["/api/work-context", "/api/task-catalog"]);
  assert.equal(Object.hasOwn(result, "tasksResult"), false);
  assert.deepEqual(result.visibleTasksResult, { tasks: [] });
  assert.deepEqual(result.assignmentsResult, { assignments: [] });
  assert.deepEqual(result.workContext, { path: "/api/work-context", allowed: true });
});

test("each Work area dispatches only its own authorized reads", async () => {
  const { readWorkRouteData } = await loadRoute();
  const readPlan = Object.fromEntries(Object.keys(emptyPlan()).map((key) => [key, true]));
  const expected = {
    tasks: ["/api/task-catalog", "/api/work-context", "/api/work/tasks/visible?limit=30&status=blocked&q=handoff"],
    reviews: ["/api/reviews/pending"],
    requests: ["/api/task-handover-requests", "/api/task-reviewer-requests"],
    "reviewer-management": ["/api/task-assignments/reviewer-management?limit=25"],
    context: ["/api/work-context"],
  };

  for (const [workArea, paths] of Object.entries(expected)) {
    const host = reader();
    await readWorkRouteData({
      readPlan,
      canCreateTasks: true,
      workArea,
      searchParams: new URLSearchParams("taskStatus=blocked&taskSearch=handoff"),
      lifetime: host.lifetime,
      pageApi: host.pageApi,
    });
    const requestedPaths = host.calls.flatMap(({ path, options }) => path === "/api/work/page-read"
      ? options.body.reads
      : [path]);
    assert.deepEqual(requestedPaths.sort(), [...paths].sort(), `${workArea} only reads its feature data`);
  }
});

test("a request for an unavailable area cannot introduce reads outside the plan", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader();
  await readWorkRouteData({
    readPlan: { ...emptyPlan(), assignments: true },
    workArea: "reviewer-management",
    searchParams: new URLSearchParams("area=reviewer-management"),
    lifetime: host.lifetime,
    pageApi: host.pageApi,
  });

  assert.deepEqual(host.calls.map(({ path, options }) => path === "/api/work/page-read"
    ? options.body.reads
    : [path]).flat(), ["/api/work/assignments/mine?limit=30"]);
});

test("focused review routes request only the server-filtered pending review feed", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader();
  const readPlan = Object.fromEntries(Object.keys(emptyPlan()).map((key) => [key, true]));
  await readWorkRouteData({
    readPlan,
    hasReviewRoute: true,
    reviewTarget: { taskId: "task-1" },
    lifetime: host.lifetime,
    pageApi: host.pageApi,
  });

  assert.deepEqual(host.calls.map(({ path }) => path), ["/api/reviews/pending?taskId=task-1"]);
});

test("focused collaboration links read only their exact participant request", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader();
  const readPlan = Object.fromEntries(Object.keys(emptyPlan()).map((key) => [key, true]));
  await readWorkRouteData({
    readPlan,
    focusRequest: { kind: "handover", id: "22222222-2222-4222-8222-222222222222" },
    lifetime: host.lifetime,
    pageApi: host.pageApi,
  });

  assert.deepEqual(host.calls.map(({ path }) => path), [
    "/api/task-handover-requests?requestId=22222222-2222-4222-8222-222222222222",
  ]);
});

test("read failures stay local and do not discard other authorized results", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader({
    pageApi: async (path) => {
      if (path === "/api/work-sessions/mine") throw Object.assign(new Error("private transport detail"), { code: "REQUEST_FAILED" });
      return { path, rows: [path] };
    },
  });
  const result = await readWorkRouteData({
    readPlan: { ...emptyPlan(), assignments: true, sessions: true },
    lifetime: host.lifetime,
    pageApi: host.pageApi,
  });

  assert.deepEqual(host.calls.map(({ path }) => path).sort(), [
    "/api/work-sessions/mine", "/api/work/assignments/mine?limit=30",
  ].sort());
  assert.deepEqual(result.assignmentsResult, { path: "/api/work/assignments/mine?limit=30", rows: ["/api/work/assignments/mine?limit=30"] });
  assert.deepEqual(result.sessionsResult, { sessions: [], readError: "REQUEST_FAILED" });
  assert.equal("private transport detail" in result.sessionsResult, false);
});

test("unplanned features retain stable empty fallbacks without making API requests", async () => {
  const { readWorkRouteData } = await loadRoute();
  const host = reader();
  const result = await readWorkRouteData({ readPlan: emptyPlan(), lifetime: host.lifetime, pageApi: host.pageApi });

  assert.deepEqual(host.calls, []);
  assert.deepEqual(result.timeline.events, []);
  assert.deepEqual(result.workContext.taskCreationTargets, []);
  assert.deepEqual(result.reviewerManagementResult, {
    assignments: [], hasMore: false, nextCursor: null, limit: 25,
  });
});
