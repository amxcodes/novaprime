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
const { formatElapsed, getElapsedMilliseconds, getWorkSessionStatus, WorkSessions } = require("./WorkSessions.tsx");

const timestamp = "2026-10-02T10:00:00.000Z";
const running = {
  id: "session-1",
  title: "Prepare the delivery brief",
  startedAt: timestamp,
  endedAt: null,
  state: "running",
  closureReason: null,
  durationMilliseconds: 3_661_000,
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WorkSessions, {
    canRead: true,
    eligibility: { canPause: true, canStop: true },
    read: { status: "ready", sessions: [running], readAt: 3_661_000 },
    onPause: async () => {},
    onStop: async () => {},
    ...props,
  }));
}

test("read capability is independent and suppresses all session content when absent", () => {
  assert.equal(render({ canRead: false }), "");
});

test("renders an active session, elapsed duration, and separately eligible actions", () => {
  const html = render();
  assert.match(html, /Prepare the delivery brief/);
  assert.match(html, /Running/);
  assert.match(html, /01:01:01/);
  assert.match(html, /aria-label="Elapsed 1 hours, 1 minutes, 1 seconds"/);
  assert.match(html, />Pause</);
  assert.match(html, />Stop</);
  const titleId = html.match(/<h3\b[^>]*\bid="([^"]+)"[^>]*>Prepare the delivery brief<\/h3>/)?.[1];
  assert.ok(titleId, "session heading has an id for the action-group name");
  assert.ok(html.includes(`role="group" aria-labelledby="${titleId}"`));

  const pauseOnly = render({ eligibility: { canPause: true, canStop: false } });
  assert.match(pauseOnly, />Pause</);
  assert.doesNotMatch(pauseOnly, />Stop</);

  const noActions = render({ eligibility: { canPause: false, canStop: false } });
  assert.match(noActions, /active timer remains visible/i);
  assert.doesNotMatch(noActions, />Pause</);
  assert.doesNotMatch(noActions, />Stop</);
});

test("closed sessions retain the server duration and never show running controls", () => {
  const paused = { ...running, endedAt: "2026-10-02T11:01:01.000Z", state: "completed", closureReason: "PAUSED" };
  const html = render({ read: { status: "ready", sessions: [paused], readAt: 100_000_000 } });
  assert.match(html, /Paused/);
  assert.match(html, /01:01:01/);
  assert.doesNotMatch(html, />Pause</);
  assert.doesNotMatch(html, />Stop</);
  assert.equal(getWorkSessionStatus(paused).label, "Paused");
});

test("initial loading, denial, read failure, and empty success have distinct feedback", () => {
  assert.match(render({ read: { status: "loading" } }), /Loading work sessions/);
  assert.match(render({ read: { status: "denied", message: "No session grant." } }), /No session grant\./);
  const error = render({ read: { status: "error", message: "Retry safely.", onRetry() {} } });
  assert.match(error, /Work sessions could not load/);
  assert.match(error, /Try again/);
  assert.match(render({ read: { status: "ready", sessions: [], readAt: Date.now() } }), /No work sessions in the last 31 days/);
});

test("running duration advances from the host read timestamp while a closed duration stays fixed", () => {
  const readAt = 3_661_000;
  assert.equal(getElapsedMilliseconds(running, readAt + 9_000, readAt), 3_670_000);
  const paused = { ...running, endedAt: "2026-10-02T11:01:01.000Z", state: "completed", closureReason: "PAUSED" };
  assert.equal(getElapsedMilliseconds(paused, readAt + 3_600_000, readAt), 3_661_000);
  assert.equal(formatElapsed(100 * 60 * 60 * 1000 + 62_000), "100:01:02");
});
