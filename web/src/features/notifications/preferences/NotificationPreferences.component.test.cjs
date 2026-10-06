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
const { NotificationPreferences } = require("./NotificationPreferences.tsx");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(NotificationPreferences, {
    state: { status: "ready", preferences: [] },
    pendingEventKeys: [],
    onSetEmailPreference: async () => {},
    onRetry() {},
    ...overrides,
  }));
}

test("Settings preference states explain loading, failure with retry, and no available choices", () => {
  const loading = render({ state: { status: "loading" } });
  const failed = render({ state: { status: "failed", message: "Try again later." } });
  const empty = render({ state: { status: "ready", preferences: [] } });

  assert.match(loading, /Loading email preferences/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Email preferences could not load/);
  assert.match(failed, /Try again/);
  assert.match(empty, /No email notification options/);
});

test("optional email settings are accessible switches with their current values", () => {
  const html = render({
    state: {
      status: "ready",
      preferences: [
        { eventKey: "task.submitted", label: "Task submitted", enabled: true },
        { eventKey: "task.assigned", label: "Task assigned", enabled: false },
      ],
    },
  });

  assert.match(html, /role="switch"[^>]*aria-checked="true"[^>]*aria-label="Email Task submitted"/);
  assert.match(html, /role="switch"[^>]*aria-checked="false"[^>]*aria-label="Email Task assigned"/);
  const descriptions = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(descriptions).size, 2);
  for (const id of descriptions) assert.ok(html.includes(`id="${id}"`));
});

test("pending state is tracked per event so concurrent updates do not unlock each other", () => {
  const html = render({
    state: {
      status: "ready",
      preferences: [
        { eventKey: "task.submitted", label: "Task submitted", enabled: true },
        { eventKey: "task.assigned", label: "Task assigned", enabled: false },
      ],
    },
    pendingEventKeys: ["task.submitted"],
  });

  assert.match(html, /aria-label="Email Task submitted"[^>]*aria-describedby="[^"]+" aria-busy="true" disabled=""/);
  assert.match(html, /aria-label="Email Task assigned"[^>]*aria-describedby="[^"]+"/);
  assert.doesNotMatch(html, /aria-label="Email Task assigned"[^>]*disabled=""/);
});

test("Settings is the only preference API owner and guards reads, writes, and refresh races", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../../app.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "controller.ts"), "utf8");
  const settingsRoute = fs.readFileSync(path.join(__dirname, "../../../../app/settings-page-route.js"), "utf8");
  const settingsStart = host.indexOf("async function renderSettings(lifetime)");
  const inboxStart = host.indexOf("async function renderNotifications(lifetime)");
  const inboxEnd = host.indexOf("async function renderAttendance(lifetime)", inboxStart);
  const adapterStart = host.indexOf("async function mountSettingsNotificationPreferences(");
  const adapterEnd = host.indexOf("\nasync function mountSettingsAccountSecurity(", adapterStart);
  const settings = host.slice(settingsStart, inboxStart);
  const inbox = host.slice(inboxStart, inboxEnd);
  const adapter = host.slice(adapterStart, adapterEnd);

  assert.ok(settingsStart >= 0 && inboxStart > settingsStart && inboxEnd > inboxStart);
  assert.match(settings, /mountNotificationPreferences: \(target, isCurrent\) => mountSettingsNotificationPreferences\(target, isCurrent, lifetime\)/);
  assert.match(settings, /const isCurrentSettings = \(\) => isCurrentPageRequest\(lifetime\) && state\.identityEpoch === settingsIdentityEpoch/);
  assert.match(host, /if \(view === "notifications"\) return renderNotifications\(lifetime\);[\s\S]*?return renderSettings\(lifetime\);/);
  assert.doesNotMatch(inbox, /notification-preferences|\/api\/notification-preferences|preferences:/);
  assert.match(inbox, /void notificationsRoute\.load\(\)/);
  assert.match(settingsRoute, /target\.querySelector\("#notification-preferences-root"\)/);
  assert.match(settingsRoute, /sections\.mountNotificationPreferences\(notificationPreferencesRoot, isCurrentSettings\)/);

  assert.match(adapter, /import\("\.\/src\/features\/notifications\/preferences\/index\.ts"\)/);
  assert.match(adapter, /const identityEpoch = state\.identityEpoch/);
  assert.match(adapter, /isCurrentSettings\(\)/);
  assert.match(adapter, /pageApi\("\/api\/notification-preferences", lifetime\)/);
  assert.match(adapter, /api\("\/api\/notification-preferences", requestOptions\("PATCH", \{\s*eventKey, channel: "email", enabled,/);
  assert.match(adapter, /feature\.createNotificationPreferencesController\(/);
  assert.match(adapter, /setMessage\("Email preference saved\."\)/);
  assert.match(adapter, /isCurrentCommand,/);
  assert.match(controller, /let readGeneration = 0/);
  assert.match(controller, /generation !== readGeneration/);
  assert.match(controller, /\.filter\(\(value\).*channel === "email"/);
  assert.match(controller, /pendingEventKeys\.has\(eventKey\)/);
  assert.match(controller, /dependencies\.isCurrentCommand\(context\)/);
  assert.match(controller, /await refresh\(\)[\s\S]*?dependencies\.onSaveConfirmed\(\)/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a late preferences read cannot replace a newer retry, and non-email rows stay out", async () => {
  const firstRead = deferred();
  const secondRead = deferred();
  let readIndex = 0;
  const updates = [];
  const { createNotificationPreferencesController } = require("./controller.ts");
  const controller = createNotificationPreferencesController({
    isCurrent: () => true,
    readPreferences: () => [firstRead, secondRead][readIndex++].promise,
    savePreference: async () => {},
    runActionButton: async (_source, action) => action({}),
    isCurrentCommand: () => true,
    errorMessage: () => "Preferences could not load.",
    onStateChange: (state) => updates.push(state),
    onSaveConfirmed() {},
  });

  controller.start();
  controller.retry();
  secondRead.resolve({ preferences: [
    { channel: "email", eventKey: "task.assigned", label: "Task assigned", enabled: true },
    { channel: "in_app", eventKey: "task.assigned", label: "Task assigned", enabled: true, required: true },
  ] });
  await nextTurn();
  assert.deepEqual(updates.at(-1), {
    status: "ready",
    preferences: [{ eventKey: "task.assigned", label: "Task assigned", enabled: true }],
  });
  firstRead.resolve({ preferences: [{ channel: "email", eventKey: "task.assigned", label: "Old value", enabled: false }] });
  await nextTurn();
  assert.deepEqual(updates.at(-1), {
    status: "ready",
    preferences: [{ eventKey: "task.assigned", label: "Task assigned", enabled: true }],
  });
});

test("concurrent rows stay pending independently and a duplicate row cannot submit twice", async () => {
  const updates = [];
  const writes = new Map();
  let confirmations = 0;
  const { createNotificationPreferencesController } = require("./controller.ts");
  const controller = createNotificationPreferencesController({
    isCurrent: () => true,
    readPreferences: async () => ({ preferences: [] }),
    savePreference: (eventKey) => {
      const pending = deferred();
      writes.set(eventKey, pending);
      return pending.promise;
    },
    runActionButton: async (_source, action) => action({}),
    isCurrentCommand: () => true,
    errorMessage: () => "Preferences could not load.",
    onStateChange: (state, pending) => updates.push({ state, pending }),
    onSaveConfirmed: () => { confirmations += 1; },
  });

  controller.start();
  await nextTurn();
  const first = controller.setEmailPreference("task.assigned", false, {});
  const second = controller.setEmailPreference("task.submitted", true, {});
  const duplicate = controller.setEmailPreference("task.assigned", true, {});
  await nextTurn();
  assert.equal(writes.size, 2);
  assert.deepEqual(updates.at(-1).pending.sort(), ["task.assigned", "task.submitted"]);

  writes.get("task.assigned").resolve();
  await first;
  assert.deepEqual(updates.at(-1).pending, ["task.submitted"]);
  assert.equal(confirmations, 1);

  writes.get("task.submitted").resolve();
  await Promise.all([second, duplicate]);
  assert.deepEqual(updates.at(-1).pending, []);
  assert.equal(confirmations, 2);
});

test("preference reads and writes cannot publish success after the actor scope changes", async () => {
  let current = true;
  const read = deferred();
  const write = deferred();
  const updates = [];
  let confirmations = 0;
  const { createNotificationPreferencesController } = require("./controller.ts");
  const controller = createNotificationPreferencesController({
    isCurrent: () => current,
    readPreferences: () => read.promise,
    savePreference: () => write.promise,
    runActionButton: async (_source, action) => action({}),
    isCurrentCommand: () => current,
    errorMessage: () => "Preferences could not load.",
    onStateChange: (state, pending) => updates.push({ state, pending }),
    onSaveConfirmed: () => { confirmations += 1; },
  });

  controller.start();
  current = false;
  read.resolve({ preferences: [] });
  await nextTurn();
  assert.equal(updates.length, 1);

  current = true;
  const save = controller.setEmailPreference("task.assigned", false, {});
  await nextTurn();
  current = false;
  write.resolve();
  await save;
  assert.equal(confirmations, 0);
  assert.equal(updates.length, 2);
});

test("preference layout adapts to its container and preserves keyboard, touch, and forced-color affordances", () => {
  const css = fs.readFileSync(path.join(__dirname, "NotificationPreferences.module.css"), "utf8");

  assert.match(css, /container:\s*notification-preferences\s*\/\s*inline-size/);
  assert.match(css, /@container notification-preferences\s*\(max-width:\s*39\.999rem\)/);
  assert.match(css, /@container notification-preferences\s*\(max-width:\s*22\.499rem\)[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /\.switch:focus-visible/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
});
