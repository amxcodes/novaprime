const assert = require("node:assert/strict");
const { test } = require("node:test");

const WfhRequestPanel = () => null;
const LeaveRequestPanel = () => null;
const routeModule = import("./my-day-request-route.js");

function makeTarget() {
  return {
    isConnected: true,
    attributes: new Map(),
    children: [],
    textContent: "",
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    replaceChildren(...children) { this.children = children; },
  };
}

async function createHarness(overrides = {}) {
  const { createMyDayRequestRoute } = await routeModule;
  const lifetime = { id: "page-1" };
  const calls = [];
  const pageReads = [];
  const mounted = [];
  const messages = [];
  let current = true;
  let feedbackCount = 0;
  let renderCount = 0;
  const api = async (path, options) => {
    calls.push({ path, options });
    if (overrides.api) return overrides.api(path, options);
    return { requests: [] };
  };
  const pageApi = async (path, token) => {
    pageReads.push({ path, token });
    if (overrides.pageApi) return overrides.pageApi(path, token);
    return { requests: [{
      id: "request-1", startDate: "2026-10-10", endDate: "2026-10-11",
      status: "pending", reviewReason: null, canCancel: true,
    }] };
  };
  const route = createMyDayRequestRoute({
    getPageRequestLifetime: () => lifetime,
    isCurrentPageRequest: (token) => current && token === lifetime,
    mountReactIsland: (host, component, props) => mounted.push({ host, component, props }),
    api,
    pageApi,
    requestOptions: (method, body) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    errorText: (error) => error.message || String(error),
    setMessage: (message) => messages.push(message),
    render: () => { renderCount += 1; },
    withSubmitForm: (_form, work) => work(),
    runActionButton: (_source, work) => work({ command: true }),
    isCurrentCommand: () => current,
    showFeedback: () => { feedbackCount += 1; },
    loadWfhPanel: overrides.loadWfhPanel || (async () => ({ WfhRequestPanel })),
    loadLeavePanel: overrides.loadLeavePanel || (async () => ({ LeaveRequestPanel })),
  });
  return {
    route, lifetime, calls, pageReads, mounted, messages,
    get current() { return current; }, set current(value) { current = value; },
    get feedbackCount() { return feedbackCount; }, get renderCount() { return renderCount; },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const latestProps = (harness, component) => harness.mounted.filter((item) => item.component === component).at(-1)?.props;

test("WFH read uses the page-scoped endpoint and projects only the request fields consumed by My Day", async () => {
  const harness = await createHarness();
  const target = makeTarget();
  harness.route.renderWfhRequestPanel(target);

  assert.equal(target.attributes.get("aria-busy"), "true");
  assert.equal(target.textContent, "Loading your WFH request panel…");
  await flush();

  assert.deepEqual(harness.pageReads, [{ path: "/api/availability/wfh/mine", token: harness.lifetime }]);
  assert.deepEqual(latestProps(harness, WfhRequestPanel).read, {
    status: "ready",
    requests: [{
      id: "request-1", startDate: "2026-10-10", endDate: "2026-10-11",
      status: "pending", reviewReason: null, canCancel: true,
    }],
  });
  assert.equal(target.attributes.has("aria-busy"), false);
});

test("WFH create and cancel preserve exact server paths, payloads, and host command checks", async () => {
  const harness = await createHarness();
  harness.route.renderWfhRequestPanel(makeTarget());
  await flush();
  const props = latestProps(harness, WfhRequestPanel);

  await props.onSubmit({ startDate: "2026-10-12", endDate: "2026-10-13", reason: "Travel" }, {});
  assert.deepEqual(harness.calls.at(-1), {
    path: "/api/availability/wfh",
    options: { method: "POST", body: JSON.stringify({
      startDate: "2026-10-12", endDate: "2026-10-13", reason: "Travel",
    }) },
  });
  assert.equal(harness.messages.at(-1), "WFH request submitted for approval.");

  await props.onCancel("request/a", {});
  assert.equal(harness.calls.at(-1).path, "/api/availability/wfh/request%2Fa/cancel");
  assert.deepEqual(harness.calls.at(-1).options, { method: "POST" });
  assert.equal(harness.messages.at(-1), "WFH request cancelled.");
});

test("WFH retry publishes errors and ignores a request that resolves after its page lifetime ends", async () => {
  let readCount = 0;
  let resolveStale;
  const harness = await createHarness({
    pageApi: async () => {
      readCount += 1;
      if (readCount === 1) throw new Error("temporary read failure");
      return new Promise((resolve) => { resolveStale = resolve; });
    },
  });
  harness.route.renderWfhRequestPanel(makeTarget());
  await flush();
  assert.deepEqual(latestProps(harness, WfhRequestPanel).read, {
    status: "error", message: "temporary read failure",
  });

  latestProps(harness, WfhRequestPanel).onRetry();
  await flush();
  harness.current = false;
  resolveStale({ requests: [{ id: "stale", canCancel: true }] });
  await flush();
  assert.equal(readCount, 2);
  assert.equal(latestProps(harness, WfhRequestPanel).read.status, "loading");
  assert.equal(latestProps(harness, WfhRequestPanel).read.requests, undefined);
});

test("leave list reads use the page-scoped API and preserve projection, creation, and cancellation contracts", async () => {
  const harness = await createHarness({
    pageApi: async (path) => path === "/api/leave/mine" ? { requests: [{
      id: "leave-1", leaveType: "annual", status: "pending", startDate: "2026-10-10",
      endDate: "2026-10-11", canCancel: true, privateServerField: "not projected",
    }] } : { requests: [] },
  });
  harness.route.renderLeaveRequestPanel(makeTarget());
  await flush();
  assert.deepEqual(harness.pageReads, [{ path: "/api/leave/mine", token: harness.lifetime }]);
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(latestProps(harness, LeaveRequestPanel).read, {
    status: "ready",
    requests: [{
      id: "leave-1", leaveType: "annual", status: "pending", startDate: "2026-10-10",
      endDate: "2026-10-11", canCancel: true,
    }],
  });

  const props = latestProps(harness, LeaveRequestPanel);
  await props.onSubmit({
    leaveType: "annual", startDate: "2026-10-12", endDate: "2026-10-14", portion: "0.5", reason: "Appointment",
  }, {});
  const create = harness.calls.at(-1);
  assert.equal(create.path, "/api/leave");
  assert.equal(create.options.method, "POST");
  assert.deepEqual(JSON.parse(create.options.body), {
    leaveType: "annual", startDate: "2026-10-12", endDate: "2026-10-14", reason: "Appointment",
    days: [
      { date: "2026-10-12", portion: 0.5 },
      { date: "2026-10-13", portion: 0.5 },
      { date: "2026-10-14", portion: 0.5 },
    ],
  });

  const callsBeforeCancel = harness.calls.length;
  await props.onCancel("leave/a", {});
  assert.equal(harness.calls[callsBeforeCancel].path, "/api/leave/leave%2Fa/cancel");
  assert.deepEqual(harness.calls[callsBeforeCancel].options, { method: "POST" });
  assert.deepEqual(harness.pageReads.at(-1), { path: "/api/leave/mine", token: harness.lifetime });
  assert.equal(harness.messages.at(-1), "Leave request cancelled.");
  assert.equal(harness.feedbackCount, 1);
});

test("a 401 recovered by the page host invalidates the leave read without publishing a stale panel error", async () => {
  const unauthorized = Object.assign(new Error("UNAUTHORIZED"), { code: "UNAUTHORIZED", httpStatus: 401 });
  let harness;
  let hostRecoveryCount = 0;
  harness = await createHarness({
    pageApi: async () => {
      hostRecoveryCount += 1;
      harness.current = false;
      throw unauthorized;
    },
  });
  harness.route.renderLeaveRequestPanel(makeTarget());
  await flush();

  assert.equal(hostRecoveryCount, 1);
  assert.deepEqual(harness.pageReads, [{ path: "/api/leave/mine", token: harness.lifetime }]);
  assert.equal(latestProps(harness, LeaveRequestPanel).read.status, "loading");
  assert.notEqual(latestProps(harness, LeaveRequestPanel).read.message, "UNAUTHORIZED");
});

test("a current-page 403 remains a leave-panel access error without invalidating the session", async () => {
  const forbidden = Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED", httpStatus: 403 });
  const harness = await createHarness({
    pageApi: async () => { throw forbidden; },
  });
  harness.route.renderLeaveRequestPanel(makeTarget());
  await flush();

  assert.equal(harness.current, true);
  assert.deepEqual(harness.pageReads, [{ path: "/api/leave/mine", token: harness.lifetime }]);
  assert.deepEqual(latestProps(harness, LeaveRequestPanel).read, {
    status: "error", message: "PERMISSION_DENIED",
  });
});

test("leave reads do not mount results after the panel is removed", async () => {
  let resolveRead;
  const harness = await createHarness({ pageApi: async () => new Promise((resolve) => { resolveRead = resolve; }) });
  const target = makeTarget();
  harness.route.renderLeaveRequestPanel(target);
  await flush();
  assert.deepEqual(harness.pageReads, [{ path: "/api/leave/mine", token: harness.lifetime }]);
  target.isConnected = false;
  resolveRead({ requests: [{ id: "removed-panel" }] });
  await flush();
  assert.equal(latestProps(harness, LeaveRequestPanel).read.status, "loading");
});

test("a failed feature chunk replaces the busy placeholder with the accessible retry guidance", async () => {
  const previousDocument = global.document;
  global.document = { createElement: () => makeTarget() };
  try {
    const harness = await createHarness({ loadWfhPanel: async () => { throw new Error("chunk unavailable"); } });
    const target = makeTarget();
    harness.route.renderWfhRequestPanel(target);
    await flush();

    assert.equal(target.attributes.has("aria-busy"), false);
    assert.equal(target.attributes.has("aria-live"), false);
    assert.equal(target.children.length, 1);
    assert.equal(target.children[0].attributes.get("role"), "alert");
    assert.equal(target.children[0].className, "small");
    assert.equal(target.children[0].textContent, "The WFH request panel could not load. Refresh My Day to try again.");
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});
