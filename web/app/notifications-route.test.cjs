const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createNotificationsRoute } = require("./notifications-route.js");

function makeRoute(overrides = {}) {
  const events = [];
  let current = true;
  const route = createNotificationsRoute({
    readNotifications: async () => ({ notifications: [] }),
    markNotificationRead: async (id) => { events.push(["read", id]); },
    markAllNotificationsRead: async () => { events.push(["read-all"]); },
    runCommand: async (_source, work) => work({ command: "current" }),
    isCurrent: () => current,
    isCommandCurrent: (context) => context?.command === "current",
    isCommandIdentityCurrent: (context) => context?.command === "current",
    errorMessage: (error) => error.message,
    refreshUnreadCount: () => { events.push(["refresh-count"]); },
    onSuccess: (kind) => { events.push(["success", kind]); },
    onChange: (state) => { events.push(["state", state.status]); },
    ...overrides,
  });
  return {
    route,
    events,
    setCurrent(value) { current = value; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("loads the server-returned notification list into ready state without inventing pagination", async () => {
  const rows = [{ id: "n-1", title: "Task assigned" }];
  const calls = [];
  const { route, events } = makeRoute({
    readNotifications: async () => { calls.push("read"); return { notifications: rows }; },
  });

  assert.deepEqual(route.getState(), { status: "loading" });
  assert.equal(await route.load(), true);
  assert.deepEqual(calls, ["read"]);
  assert.deepEqual(route.getState(), { status: "ready", notifications: rows });
  assert.deepEqual(events, [["state", "ready"]]);
});

test("failed and malformed inbox reads expose recoverable state; retry starts loading again", async () => {
  let attempts = 0;
  const { route, events } = makeRoute({
    readNotifications: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      if (attempts === 2) return { notifications: null };
      return { notifications: [] };
    },
    errorMessage: (error) => `Inbox error: ${error.message}`,
  });

  assert.equal(await route.load(), false);
  assert.deepEqual(route.getState(), { status: "failed", message: "Inbox error: offline" });
  assert.equal(await route.retry(), false);
  assert.deepEqual(route.getState(), { status: "failed", message: "Inbox error: Invalid notifications response" });
  assert.equal(await route.retry(), true);
  assert.deepEqual(route.getState(), { status: "ready", notifications: [] });
  assert.deepEqual(events, [
    ["state", "failed"],
    ["state", "loading"],
    ["state", "failed"],
    ["state", "loading"],
    ["state", "ready"],
  ]);
});

test("stale page reads do not publish or overwrite route state", async () => {
  let finishRead;
  const { route, events, setCurrent } = makeRoute({
    readNotifications: () => new Promise((resolve) => { finishRead = resolve; }),
  });
  const pending = route.load();
  setCurrent(false);
  finishRead({ notifications: [{ id: "stale" }] });

  assert.equal(await pending, false);
  assert.deepEqual(route.getState(), { status: "loading" });
  assert.deepEqual(events, []);
});

test("marking one notification refreshes the inbox and unread count before success feedback", async () => {
  const rows = [{ id: "n-1", readAt: "now" }];
  const { route, events } = makeRoute({
    markNotificationRead: async (id) => { events.push(["read", id]); },
    readNotifications: async () => { events.push(["load"]); return { notifications: rows }; },
  });

  await route.markRead("n-1", {});
  assert.deepEqual(events, [
    ["read", "n-1"],
    ["refresh-count"],
    ["load"],
    ["state", "ready"],
    ["success", "read"],
  ]);
});

test("mark-all uses its separate command and the same refresh and success order", async () => {
  const { route, events } = makeRoute({
    markAllNotificationsRead: async () => { events.push(["read-all"]); },
    readNotifications: async () => { events.push(["load"]); return { notifications: [] }; },
  });

  await route.markAllRead({});
  assert.deepEqual(events, [
    ["read-all"],
    ["refresh-count"],
    ["load"],
    ["state", "ready"],
    ["success", "all"],
  ]);
});

test("a slower post-action inbox read cannot overwrite a newer read-all result", async () => {
  const firstRead = deferred();
  const secondRead = deferred();
  const reads = [firstRead, secondRead];
  let readIndex = 0;
  const { route } = makeRoute({
    readNotifications: () => reads[readIndex++].promise,
  });

  const markOne = route.markRead("n-1", {});
  const markAll = route.markAllRead({});
  await nextTurn();
  assert.equal(readIndex, 2);

  secondRead.resolve({ notifications: [
    { id: "n-1", readAt: "2026-10-05T10:02:00.000Z" },
    { id: "n-2", readAt: "2026-10-05T10:02:00.000Z" },
  ] });
  await nextTurn();
  assert.equal(route.getState().status, "ready");
  assert.ok(route.getState().notifications.every(({ readAt }) => readAt));

  firstRead.resolve({ notifications: [
    { id: "n-1", readAt: "2026-10-05T10:01:00.000Z" },
    { id: "n-2", readAt: null },
  ] });
  await Promise.all([markOne, markAll]);

  assert.ok(route.getState().notifications.every(({ readAt }) => readAt));
});

test("command revocation or page/identity changes suppress reload feedback", async () => {
  const revoked = makeRoute({
    isCommandCurrent: () => false,
  });
  await revoked.route.markRead("n-1", {});
  assert.deepEqual(revoked.events, [["read", "n-1"]]);

  const changedIdentity = makeRoute({
    isCommandIdentityCurrent: () => false,
  });
  await changedIdentity.route.markAllRead({});
  assert.deepEqual(changedIdentity.events, [["read-all"], ["refresh-count"], ["state", "ready"]]);
});

test("refresh and feedback failures do not turn a committed read action into a command error", async () => {
  const { route } = makeRoute({
    refreshUnreadCount: () => { throw new Error("refresh failed"); },
    onSuccess: () => { throw new Error("feedback failed"); },
  });
  assert.equal(await route.markRead("n-1", {}), undefined);
  assert.deepEqual(route.getState(), { status: "ready", notifications: [] });
});

test("route construction requires page and command lifecycle guards", () => {
  assert.throws(() => createNotificationsRoute({
    readNotifications: async () => ({ notifications: [] }),
    markNotificationRead: async () => {},
    markAllNotificationsRead: async () => {},
    runCommand: async (_source, action) => action({}),
  }), /isCurrent must be a function/);
});

test("renderNotifications delegates inbox state/actions and retains host APIs and deep-link resolution", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = app.indexOf("async function renderNotifications(lifetime)");
  const end = app.indexOf("\nasync function ", start + 1);
  const route = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(route, /import\("\.\/app\/notifications-route\.js"\)/);
  assert.match(route, /readNotifications: \(\) => pageApi\("\/api\/notifications\?limit=100", lifetime\)/);
  assert.match(route, /markNotificationRead: \(id\) => api\("\/api\/notifications\/" \+ id \+ "\/read", requestOptions\("POST"\)\)/);
  assert.match(route, /markAllNotificationsRead: \(\) => api\("\/api\/notifications\/read-all", requestOptions\("POST"\)\)/);
  assert.match(route, /resolveNotificationDeepLink\(rawDeepLink, \{/);
  assert.match(route, /grants: state\.actorGrants/);
  assert.match(route, /refreshUnreadCount: \(\) => \{ void refreshUnreadNotificationCount\(\); \}/);
  assert.match(route, /onSuccess: \(kind\) => \{[\s\S]*?setMessage\(kind === "read"[\s\S]*?showFeedback\(\);/);
});
