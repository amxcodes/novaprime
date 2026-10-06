const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createMyDayTimelineRoute } = require("./my-day-timeline-route.js");

const projection = {
  date: "2026-10-03",
  events: [],
  exceptions: [],
  attendanceSummary: { durationMinutes: 0, requiredMinutes: 480, requirementSatisfied: false },
  attendancePolicy: null,
};

function makeRoute(overrides = {}) {
  const calls = [];
  const changes = [];
  let current = true;
  const route = createMyDayTimelineRoute({
    visible: true,
    readPlan: { timeline: true },
    readApi: async (endpoint) => { calls.push(endpoint); return projection; },
    isCurrent: () => current,
    getReadIssue: () => undefined,
    onChange: (state) => changes.push(state),
    ...overrides,
  });
  return {
    route,
    calls,
    changes,
    setCurrent(value) { current = value; },
  };
}

test("loads the exact timeline endpoint and projects the unchanged server response", async () => {
  const { route, calls, changes } = makeRoute();

  assert.deepEqual(route.getState(), { status: "loading" });
  assert.equal(await route.load(), true);
  assert.deepEqual(calls, ["/api/work/timeline"]);
  assert.deepEqual(route.getState(), { status: "ready", data: projection });
  assert.deepEqual(changes, [{ status: "ready", data: projection }]);
});

test("does not fetch when hidden or absent from the server-derived read plan", async () => {
  let calls = 0;
  const readApi = async () => { calls += 1; return projection; };

  const hidden = makeRoute({ visible: false, readApi });
  const unauthorized = makeRoute({ readPlan: { timeline: false }, readApi });
  assert.equal(await hidden.route.load(), false);
  assert.equal(await unauthorized.route.load(), false);
  assert.equal(calls, 0);
});

test("maps permission denial and recoverable read errors to the existing copy", async () => {
  const denied = makeRoute({
    readApi: async () => ({ readError: "PERMISSION_DENIED" }),
    getReadIssue: (_result, resource) => ({ message: `Unavailable: ${resource}.` }),
  });
  assert.equal(await denied.route.load(), true);
  assert.deepEqual(denied.route.getState(), {
    status: "denied",
    message: "Unavailable: your daily timeline.",
  });
  assert.equal("onRetry" in denied.route.getState(), false);

  const failed = makeRoute({ readApi: async () => ({ readError: "REQUEST_FAILED" }) });
  assert.equal(await failed.route.load(), false);
  assert.equal(failed.route.getState().status, "error");
  assert.equal(failed.route.getState().message, "Your daily timeline could not be loaded.");
  assert.equal(typeof failed.route.getState().onRetry, "function");
});

test("malformed responses and thrown transports remain recoverable", async () => {
  const malformed = makeRoute({ readApi: async () => ({ events: [], exceptions: null }) });
  assert.equal(await malformed.route.load(), false);
  assert.deepEqual(
    { ...malformed.route.getState(), onRetry: undefined },
    {
      status: "error",
      message: "Your workday timeline is unavailable for this business date.",
      onRetry: undefined,
    },
  );

  const thrown = makeRoute({
    readApi: async () => { throw Object.assign(new Error("offline"), { code: "REQUEST_FAILED" }); },
    getReadIssue: (result) => ({ message: `Read failed: ${result.readError}.` }),
  });
  assert.equal(await thrown.route.load(), false);
  assert.equal(thrown.route.getState().message, "Read failed: REQUEST_FAILED.");
});

test("partial success without component-required summary data never reaches ready", async () => {
  const incomplete = makeRoute({ readApi: async () => ({ date: "2026-10-03", events: [], exceptions: [] }) });

  assert.equal(await incomplete.route.load(), false);
  assert.equal(incomplete.route.getState().status, "error");
  assert.equal(incomplete.route.getState().message, "Your workday timeline is unavailable for this business date.");
  assert.equal(typeof incomplete.route.getState().onRetry, "function");
});

test("retry reloads only the timeline slot and publishes a local loading state", async () => {
  const endpoints = [];
  let attempt = 0;
  const { route, changes } = makeRoute({
    readApi: async (endpoint) => {
      endpoints.push(endpoint);
      attempt += 1;
      return attempt === 1 ? { readError: "REQUEST_FAILED" } : projection;
    },
  });

  await route.load();
  const failedState = route.getState();
  assert.equal(await failedState.onRetry(), true);
  assert.deepEqual(endpoints, ["/api/work/timeline", "/api/work/timeline"]);
  assert.deepEqual(changes.map(({ status }) => status), ["error", "loading", "ready"]);
  assert.deepEqual(route.getState(), { status: "ready", data: projection });
});

test("stale page reads and superseded retries cannot overwrite current state", async () => {
  let finishFirst;
  let attempt = 0;
  const { route, changes, setCurrent } = makeRoute({
    readApi: () => {
      attempt += 1;
      if (attempt === 1) return new Promise((resolve) => { finishFirst = resolve; });
      return Promise.resolve(projection);
    },
  });

  const first = route.load();
  const retry = route.retry();
  assert.equal(await retry, true);
  finishFirst(projection);
  assert.equal(await first, false);
  assert.deepEqual(route.getState(), { status: "ready", data: projection });
  assert.deepEqual(changes.map(({ status }) => status), ["loading", "ready"]);

  let finishStale;
  const stale = makeRoute({
    readApi: () => new Promise((resolve) => { finishStale = resolve; }),
  });
  const pending = stale.route.load();
  stale.setCurrent(false);
  finishStale(projection);
  assert.equal(await pending, false);
  assert.deepEqual(stale.changes, []);
  assert.deepEqual(stale.route.getState(), { status: "loading" });
});

test("My Day page adapter keeps the authorized read plan and transport while retry remounts only the timeline slot", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "my-day-page-route.ts"), "utf8");

  assert.match(app, /mountMyDayPageRoute\(\{/);
  assert.match(route, /planMyDayPage\(/);
  assert.match(route, /myDayPlan\.mounts\[id\] && myDayPlan\.reads\[id\]/);
  assert.match(route, /visible: myDayPlan\.reads\.timeline/);
  assert.match(route, /import\("\.\/my-day-timeline-route\.js"\)/);
  assert.match(route, /readApi: \(path: string\) => readOrError\(pageApi\(path, lifetime\), \{ events: \[\], exceptions: \[\] \}\)/);
  assert.match(route, /isCurrent: \(\) => isCurrentPageRequest\(lifetime\) && timelineTarget\.isConnected/);
  assert.match(route, /mountReactIsland\(timelineTarget, attendanceComponents!\.WorkdayTimeline/);
  assert.match(route, /createMyDayTimelineRoute as unknown as TimelineRouteFactory\)\(/);
  assert.match(route, /readOrError\(pageApi\("\/api\/work\/assignments\/mine\?limit=4&status=all"/);
  assert.match(route, /readMyDayAttendance as unknown as AttendanceReadRoute\)\(/);
  assert.doesNotMatch(route, /readOrError\(pageApi\("\/api\/work\/timeline"/);
  assert.doesNotMatch(route, /timelineResult/);
});
