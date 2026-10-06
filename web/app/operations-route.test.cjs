const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { mountOperationsRoute } = require("./operations-route.js");

function setup(overrides = {}) {
  const board = { isConnected: true };
  const calls = [];
  const mounts = [];
  const exported = [];
  const recovery = [];
  const feedback = [];
  const scroll = [];
  const errors = [];
  const tasks = [{
    id: "task-1",
    title: "Ship report",
    status: "open",
    priority: "high",
    dueDate: "2026-10-08",
    assignmentCount: 3,
    client: { id: "client-1", name: "Acme" },
    workstream: { id: "stream-1", kind: "client", name: "Delivery" },
    group: { id: "group-1", name: "Team" },
    department: { id: "department-1", name: "Operations" },
    assignments: [{ personName: "Private Assignee" }],
  }];
  const availability = {
    visibility: { shifts: true, shiftOptions: true, calendars: true, holidays: true },
    shifts: [{ id: "shift-1" }],
    calendars: [{ id: "calendar-1" }],
    holidays: [{ id: "holiday-1" }],
  };
  const availabilityExports = [];
  const defaultUi = {
    OPERATIONS_AVAILABILITY_EXPORT_HEADERS: ["Kind", "Name"],
    buildAvailabilityExportRows: (data, sources) => {
      availabilityExports.push({ data, sources });
      return [["sources", Object.keys(sources).join(",")], ["rows", Object.keys(data).join(",")]];
    },
  };
  const pageUi = { OperationsPage: function OperationsPage() {} };
  const dependencies = {
    board,
    readPlan: {},
    readApi: async (endpoint) => {
      calls.push(endpoint);
      if (endpoint.startsWith("/api/work/tasks/visible")) {
        return { tasks, hasMore: false, nextCursor: null, limit: 30 };
      }
      if (endpoint === "/api/availability/config") return availability;
      if (endpoint === "/api/reviews/pending") return { reviews: [{ id: "review-1" }] };
      if (endpoint.startsWith("/api/attendance/recovery-candidates")) return { candidates: [{ id: "candidate-1" }] };
      if (endpoint.startsWith("/api/people/directory")) return { people: [], hasMore: false, nextCursor: null, limit: 25 };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
    readOrError: async (promise, fallback) => {
      try { return await promise; }
      catch (error) { return { ...fallback, readError: error.code || "REQUEST_FAILED" }; }
    },
    isCurrent: () => true,
    loadUi: async () => [defaultUi, pageUi],
    getReadIssue: (result, resource) => result?.readError
      ? { message: `${resource} issue: ${result.readError}` }
      : undefined,
    getAvailabilitySources: () => ({ shifts: true, calendars: false, holidays: true }),
    createRecoverySlot: () => ({ kind: "recovery-slot" }),
    renderRecovery: async (slot, result) => recovery.push([slot, result]),
    mountIsland: (target, component, props) => mounts.push({ target, component, props }),
    onLoadError: (error) => errors.push(["load", error]),
    onFatalError: (error) => errors.push(["fatal", error]),
    onRetry: () => feedback.push("retry"),
    onRestoreScroll: () => scroll.push("restore"),
    onShowFeedback: () => feedback.push("show"),
    personHistoryHref: (personId) => `/people/${personId || ""}`,
    onViewPersonHistory: () => {},
    taskDetailHref: (taskId) => `/task/${taskId}`,
    onOpenTask: () => {},
    taskDefinitionReference: () => "definition@4",
    downloadCsv: (...args) => exported.push(args),
    getErrorText: (error) => error.message,
    ...overrides,
  };
  return { board, calls, mounts, exported, recovery, feedback, scroll, errors, tasks, availability, availabilityExports, defaultUi, pageUi, dependencies };
}

function latestOverview(mounts) {
  assert.ok(mounts.length > 0, "expected Operations overview to mount");
  return mounts.at(-1).props.overview;
}

test("reads only effective-plan reports and projects each section independently", async () => {
  const state = setup({ readPlan: { tasks: true, reviews: false, availability: true, recovery: false, people: false } });
  await mountOperationsRoute(state.dependencies);

  assert.deepEqual(state.calls, ["/api/work/tasks/visible?limit=30&status=all", "/api/availability/config"]);
  const overview = latestOverview(state.mounts);
  assert.deepEqual(overview.tasks, { status: "ready", data: {
    tasks: [{
      id: "task-1",
      title: "Ship report",
      status: "open",
      priority: "high",
      dueDate: "2026-10-08",
      assignmentCount: 3,
      client: { name: "Acme" },
      workstream: { name: "Delivery" },
      group: { name: "Team" },
      department: { name: "Operations" },
    }],
    cursor: null,
    limit: 30,
    hasMore: false,
    nextCursor: null,
    pageNumber: 1,
    hasPrevious: false,
  }, loadingPage: false });
  assert.equal(overview.reviews, undefined);
  assert.deepEqual(overview.availability, {
    status: "ready",
    data: { shifts: state.availability.shifts, calendars: [], holidays: state.availability.holidays },
  });
  assert.deepEqual(overview.availabilitySources, { shifts: true, calendars: false, holidays: true });
  assert.equal(overview.recoverySlot, null);

  overview.onExportWork();
  overview.onExportAvailability();
  assert.equal(state.exported[0][0], "nova-work-page-1.csv");
  assert.deepEqual(state.exported[0][1], [
    "Title", "Status", "Priority", "Due date", "Client", "Workstream", "Group", "Department", "Non-cancelled assignments",
  ]);
  assert.deepEqual(state.exported[0][2], [[
    "Ship report", "open", "high", "2026-10-08", "Acme", "Delivery", "Team", "Operations", 3,
  ]]);
  assert.equal(state.exported[1][0], "nova-calendar.csv");
  assert.deepEqual(state.exported[1][2], [["sources", "shifts,calendars,holidays"], ["rows", "shifts,calendars,holidays"]]);
  assert.deepEqual(state.availabilityExports[0], {
    data: { shifts: state.availability.shifts, calendars: [], holidays: state.availability.holidays },
    sources: { shifts: true, calendars: false, holidays: true },
  });
});

test("availability source projection intersects current API visibility with the grant plan", async () => {
  const state = setup({
    readPlan: { availability: true },
    getAvailabilitySources: () => ({ shifts: true, calendars: true, holidays: true }),
    readApi: async (endpoint) => {
      state.calls.push(endpoint);
      if (endpoint === "/api/availability/config") {
        return {
          ...state.availability,
          visibility: { shifts: false, shiftOptions: true, calendars: true, holidays: false },
        };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
  });
  await mountOperationsRoute(state.dependencies);

  const overview = latestOverview(state.mounts);
  assert.deepEqual(overview.availabilitySources, { shifts: false, calendars: true, holidays: false });
  assert.deepEqual(overview.availability.data, {
    shifts: [], calendars: state.availability.calendars, holidays: [],
  });
  overview.onExportAvailability();
  assert.deepEqual(state.availabilityExports[0], {
    data: { shifts: [], calendars: state.availability.calendars, holidays: [] },
    sources: { shifts: false, calendars: true, holidays: false },
  });
});

test("availability source projection fails closed when the API omits visibility metadata", async () => {
  const state = setup({
    readPlan: { availability: true },
    getAvailabilitySources: () => ({ shifts: true, calendars: true, holidays: true }),
    readApi: async (endpoint) => {
      state.calls.push(endpoint);
      if (endpoint === "/api/availability/config") {
        const { visibility, ...withoutVisibility } = state.availability;
        return withoutVisibility;
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
  });
  await mountOperationsRoute(state.dependencies);

  const overview = latestOverview(state.mounts);
  assert.deepEqual(overview.availabilitySources, { shifts: false, calendars: false, holidays: false });
  assert.deepEqual(overview.availability.data, { shifts: [], calendars: [], holidays: [] });
});

test("a denied report remains denied while other granted sections still render", async () => {
  const state = setup({
    readPlan: { tasks: true, availability: true },
    readApi: async (endpoint) => {
      state.calls.push(endpoint);
      if (endpoint.startsWith("/api/work/tasks/visible")) throw Object.assign(new Error("forbidden"), { code: "HTTP_ERROR", httpStatus: 403 });
      if (endpoint === "/api/availability/config") return state.availability;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
  });
  await mountOperationsRoute(state.dependencies);

  const overview = latestOverview(state.mounts);
  assert.deepEqual(overview.tasks, { status: "denied", message: "You do not have permission to view tasks in this scope." });
  assert.equal(overview.availability.status, "ready");
  assert.deepEqual(state.calls, ["/api/work/tasks/visible?limit=30&status=all", "/api/availability/config"]);
});

test("recovery candidates keep their existing bounded endpoint and recovery mount", async () => {
  const state = setup({ readPlan: { recovery: true } });
  await mountOperationsRoute(state.dependencies);

  assert.deepEqual(state.calls, ["/api/attendance/recovery-candidates?limit=50"]);
  assert.deepEqual(state.recovery, [[{ kind: "recovery-slot" }, { candidates: [{ id: "candidate-1" }] }]]);
  assert.equal(latestOverview(state.mounts).recoverySlot, state.recovery[0][0]);
});

test("task report pages and exports use server cursors and only the current summary page", async () => {
  const secondTask = { ...setup().tasks[0], id: "task-2", title: "Second task", assignmentCount: 1, assignments: [{ personName: "Another private person" }] };
  const state = setup({
    readApi: async (endpoint) => {
      state.calls.push(endpoint);
      const query = new URL(endpoint, "https://nova.example").searchParams;
      if (endpoint.startsWith("/api/work/tasks/visible") && query.get("cursor") === "after-one") {
        return { tasks: [secondTask], hasMore: false, nextCursor: null, limit: 30 };
      }
      if (endpoint.startsWith("/api/work/tasks/visible")) {
        return { tasks: [state.tasks[0]], hasMore: true, nextCursor: "after-one", limit: 30 };
      }
      if (endpoint === "/api/availability/config") return state.availability;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
    readPlan: { tasks: true },
  });
  await mountOperationsRoute(state.dependencies);
  let overview = latestOverview(state.mounts);
  assert.deepEqual(overview.tasks.data.tasks.map((task) => task.id), ["task-1"]);
  overview.onNextTasksPage("after-one");
  await new Promise((resolve) => setTimeout(resolve, 0));
  overview = latestOverview(state.mounts);
  assert.deepEqual(state.calls.filter((endpoint) => endpoint.startsWith("/api/work/tasks/visible")), [
    "/api/work/tasks/visible?limit=30&status=all",
    "/api/work/tasks/visible?limit=30&status=all&cursor=after-one",
  ]);
  assert.deepEqual(overview.tasks.data.tasks.map((task) => task.id), ["task-2"]);
  assert.equal(overview.tasks.data.pageNumber, 2);
  overview.onExportWork();
  assert.equal(state.exported[0][0], "nova-work-page-2.csv");
  assert.deepEqual(state.exported[0][2], [[
    "Second task", "open", "high", "2026-10-08", "Acme", "Delivery", "Team", "Operations", 1,
  ]]);
  overview.onPreviousTasksPage();
  await new Promise((resolve) => setTimeout(resolve, 0));
  overview = latestOverview(state.mounts);
  assert.deepEqual(overview.tasks.data.tasks.map((task) => task.id), ["task-1"]);
  assert.equal(overview.tasks.data.pageNumber, 1);
  assert.deepEqual(state.calls.filter((endpoint) => endpoint.startsWith("/api/work/tasks/visible")), [
    "/api/work/tasks/visible?limit=30&status=all",
    "/api/work/tasks/visible?limit=30&status=all&cursor=after-one",
    "/api/work/tasks/visible?limit=30&status=all",
  ]);
  assert.doesNotMatch(JSON.stringify(state.exported), /private person|task-2|task-1/);
});

test("people search and cursor paging remain server-backed and export only the displayed page", async () => {
  const state = setup({
    readPlan: { people: true },
    readApi: async (endpoint) => {
      state.calls.push(endpoint);
      const query = new URL(endpoint, "https://nova.example").searchParams;
      if (endpoint.startsWith("/api/people/directory") && query.get("cursor") === "after-morgan") {
        return { people: [{ id: "jordan", displayName: "Jordan Lee", email: "jordan@example.test" }], hasMore: false, nextCursor: null, limit: 25 };
      }
      if (endpoint.startsWith("/api/people/directory") && query.get("q") === "Morgan") {
        return { people: [{ id: "morgan", displayName: "Morgan Lee", email: "morgan@example.test" }], hasMore: true, nextCursor: "after-morgan", limit: 25 };
      }
      return { people: [], hasMore: false, nextCursor: null, limit: 25 };
    },
  });
  await mountOperationsRoute(state.dependencies);
  let overview = latestOverview(state.mounts);
  overview.onSearchPeople("Morgan");
  await new Promise((resolve) => setTimeout(resolve, 0));
  overview = latestOverview(state.mounts);
  assert.equal(overview.people.status, "ready");
  assert.equal(overview.people.data.people[0].id, "morgan");
  overview.onNextPeoplePage("after-morgan");
  await new Promise((resolve) => setTimeout(resolve, 0));
  overview = latestOverview(state.mounts);
  assert.equal(overview.people.data.people[0].id, "jordan");
  overview.onExportPeople();

  assert.deepEqual(state.calls, [
    "/api/people/directory?limit=25",
    "/api/people/directory?limit=25&q=Morgan",
    "/api/people/directory?limit=25&q=Morgan&cursor=after-morgan",
  ]);
  assert.equal(state.exported[0][0], "nova-people-page.csv");
  assert.deepEqual(state.exported[0][2], [["Jordan Lee", "jordan@example.test", undefined, undefined, undefined, undefined, undefined, undefined, undefined]]);
});

test("stale or disconnected reads cannot mount over a newer page", async () => {
  let finishRead;
  const state = setup({
    readPlan: { tasks: true },
    readApi: () => new Promise((resolve) => { finishRead = resolve; }),
  });
  const pending = mountOperationsRoute(state.dependencies);
  await new Promise((resolve) => setTimeout(resolve, 0));
  state.board.isConnected = false;
  finishRead({ tasks: state.tasks, hasMore: false, nextCursor: null, limit: 30 });
  await pending;

  assert.deepEqual(state.mounts, []);
  assert.deepEqual(state.scroll, []);
});

test("lazy UI load failures are reported only while this board is current", async () => {
  const state = setup({ loadUi: async () => { throw new Error("chunk unavailable"); } });
  await mountOperationsRoute(state.dependencies);
  assert.equal(state.errors.length, 1);
  assert.equal(state.errors[0][0], "load");
  assert.deepEqual(state.scroll, ["restore"]);

  const stale = setup({ loadUi: async () => { throw new Error("chunk unavailable"); } });
  stale.board.isConnected = false;
  await mountOperationsRoute(stale.dependencies);
  assert.deepEqual(stale.errors, []);
  assert.deepEqual(stale.scroll, []);
});

test("the app host retains grant planning, authenticated transport, recovery mutation, and navigation", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = app.indexOf("async function renderOperations(lifetime)");
  const end = app.indexOf("\nfunction renderAccept", start);
  const host = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(app, /planOperationsReads\(state\.actorGrants\)/);
  assert.match(host, /readApi: \(path\) => pageApi\(path, lifetime\)/);
  assert.match(host, /getAvailabilitySources: \(\) => planOperationsAvailabilitySources\(state\.actorGrants\)/);
  assert.match(host, /renderRecovery: \(target, initialResult\) => renderAttendanceRecovery\(target, lifetime, initialResult\)/);
  assert.match(host, /onViewPersonHistory: navigatePersonHistory/);
  assert.match(host, /onOpenTask: \(taskId\) => openTaskDetail\(taskId, "operations"\)/);
  assert.match(app, /operationsRoute = await import\("\.\/app\/operations-route\.js"\)/);
  assert.match(host, /await operationsRoute\.mountOperationsRoute\(/);
  assert.doesNotMatch(host, /pageApi\("\/api\/(tasks|reviews\/pending|availability\/config)/);
});
