const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

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
const { NotificationsPage } = require("./NotificationsPage.tsx");

const callbacks = {
  onMarkRead: async () => {},
  onMarkAllRead: async () => {},
  resolveNotificationDeepLink: () => null,
  onRetryNotifications() {},
};

function render(props) {
  return renderToStaticMarkup(React.createElement(NotificationsPage, { ...callbacks, ...props }));
}

test("inbox renders its loading state accessibly and links to Settings for preferences", () => {
  const html = render({
    notifications: { status: "loading" },
  });

  assert.match(html, /Loading recent notifications/);
  assert.match(html, /Notifications/);
  assert.match(html, /href="\/\?view=settings"/);
  assert.match(html, /Manage email preferences in Settings/);
  assert.doesNotMatch(html, /Email preferences|Optional email/);
  assert.doesNotMatch(html, /Mark all read/);
});

test("bulk read is offered only when the loaded feed has unread activity or may be truncated", () => {
  const readNotification = (id) => ({
    id,
    eventKey: "task.assigned",
    title: `Update ${id}`,
    body: "This one was read.",
    deepLink: null,
    readAt: "2026-10-02T07:00:00.000Z",
    createdAt: "2026-10-02T07:00:00.000Z",
  });
  const empty = render({ notifications: { status: "ready", notifications: [] } });
  const allRead = render({ notifications: { status: "ready", notifications: [readNotification("n-1")] } });
  const possiblyTruncated = render({
    notifications: { status: "ready", notifications: Array.from({ length: 100 }, (_, index) => readNotification(`n-${index}`)) },
  });

  assert.match(empty, /You’re all caught up/);
  assert.doesNotMatch(empty, /Mark all read/);
  assert.doesNotMatch(allRead, /Mark all read/);
  assert.match(possiblyTruncated, /Mark all read/);
});

test("activity renders unread/read states and only its host-resolved internal link", () => {
  const rawDeepLink = "/?view=work&review=assignment-1";
  const html = render({
    notifications: {
      status: "ready",
      notifications: [
        { id: "n-unread", eventKey: "task.submitted", title: "Review brief", body: "A brief is ready.", deepLink: rawDeepLink, readAt: null, createdAt: "2026-10-02T08:30:00.000Z" },
        { id: "n-read", eventKey: "task.assigned", title: "Read update", body: "This one was read.", deepLink: null, readAt: "2026-10-02T08:00:00.000Z", createdAt: "2026-10-02T07:00:00.000Z" },
      ],
    },
    resolveNotificationDeepLink: (deepLink) => deepLink === rawDeepLink ? "/?view=work&review=assignment-1" : null,
  });

  assert.match(html, /Review brief/);
  assert.match(html, /href="\/\?view=work&amp;review=assignment-1"/);
  assert.match(html, /Mark Review brief as read/);
  assert.match(html, /Read notification/);
  assert.match(html, /Showing the most recent notifications returned, up to 100/);
  assert.match(html, /Mark all read/);
});

test("deep-link policy receives the event key so review and requester notices can diverge", () => {
  const calls = [];
  render({
    notifications: {
      status: "ready",
      notifications: [
        { id: "review", eventKey: "leave.requested", title: "Review leave", body: "Pending.", deepLink: "/?view=today&leave=leave-1", readAt: null, createdAt: "2026-10-02T08:30:00.000Z" },
        { id: "status", eventKey: "leave.approved", title: "Leave approved", body: "Approved.", deepLink: "/?view=today&leave=leave-2", readAt: null, createdAt: "2026-10-02T08:00:00.000Z" },
      ],
    },
    resolveNotificationDeepLink: (deepLink, eventKey) => {
      calls.push([deepLink, eventKey]);
      return null;
    },
  });

  assert.deepEqual(calls, [
    ["/?view=today&leave=leave-1", "leave.requested"],
    ["/?view=today&leave=leave-2", "leave.approved"],
  ]);
});

test("activity hides a destination the host does not allow", () => {
  const html = render({
    notifications: {
      status: "ready",
      notifications: [
        { id: "n-restricted", eventKey: "account.changed", title: "Workspace updated", body: "An update is available.", deepLink: "/?view=admin", readAt: null, createdAt: "2026-10-02T08:30:00.000Z" },
      ],
    },
    resolveNotificationDeepLink: () => null,
  });

  assert.match(html, /Workspace updated/);
  assert.doesNotMatch(html, /Open destination/);
  assert.doesNotMatch(html, /href="\/\?view=admin/);
});

test("notification failures offer a retry without coupling inbox state to Settings", () => {
  const html = render({
    notifications: { status: "failed", message: "Try again shortly." },
  });

  assert.match(html, /Notifications could not load/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /Mark all read/);
  assert.match(html, /href="\/\?view=settings"/);
});

test("compact inbox layout follows its feature container while touch sizing follows pointer capability", () => {
  const css = fs.readFileSync(`${__dirname}/NotificationsPage.module.css`, "utf8");

  assert.match(css, /\.page\s*\{[^}]*container:\s*notifications-page\s*\/\s*inline-size;/s);
  assert.match(css, /@container notifications-page\s*\(max-width:\s*39\.999rem\)[\s\S]*?\.entryHeading\s*\{[^}]*display:\s*grid;/);
  assert.match(css, /@container notifications-page\s*\(max-width:\s*39\.999rem\)[\s\S]*?\.entryActions\s*\{[^}]*align-items:\s*stretch;/);
  assert.match(css, /@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.entryActions > a,\s*\.entryActions > button\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\);/);
  assert.doesNotMatch(css, /\.entryActions > \*/);
  assert.doesNotMatch(css, /preferenceRow|\.switch\s*\{/);
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
});
