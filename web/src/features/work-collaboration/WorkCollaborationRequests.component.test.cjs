const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
const { WorkCollaborationRequests } = require("./WorkCollaborationRequests.tsx");

const request = (overrides = {}) => ({
  id: "opaque-request-id",
  kind: "reviewer",
  requestKind: "initial",
  status: "pending",
  title: "Prepare the client delivery plan",
  reason: "The next review needs a specialist.",
  createdAt: "2026-10-02T09:00:00.000Z",
  expiresAt: "2026-10-04T09:00:00.000Z",
  resolvedAt: null,
  isRecipient: true,
  canAccept: true,
  canDecline: true,
  canWithdraw: false,
  ...overrides,
});

const callbacks = { onResolve: () => {} };

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WorkCollaborationRequests, { ...callbacks, ...props }));
}

test("the host can omit endpoints that are not in the current capability read plan", () => {
  assert.equal(render({}), "");
  const markup = render({
    reviewerRequests: { status: "ready", requests: [], history: [], loadedRecordCount: 0, recordLimit: 100 },
  });
  assert.match(markup, /Reviewer requests/);
  assert.doesNotMatch(markup, /Handover requests/);
});

test("reviewer and handover read failures remain independent", () => {
  const markup = render({
    reviewerRequests: { status: "error", message: "Reviewer service timed out." },
    handoverRequests: { status: "ready", requests: [], history: [], loadedRecordCount: 0, recordLimit: 100 },
  });
  assert.match(markup, /Reviewer requests could not be loaded/);
  assert.match(markup, /Reviewer service timed out\./);
  assert.match(markup, /No pending handover requests/);
  assert.doesNotMatch(markup, /Handover requests could not be loaded/);
});

test("the feature renders only capabilities projected onto the individual request", () => {
  const markup = render({
    reviewerRequests: {
      status: "ready",
      requests: [request({ canAccept: false, canDecline: true, canWithdraw: false })],
      history: [],
      loadedRecordCount: 1,
      recordLimit: 100,
    },
  });
  assert.match(markup, /Prepare the client delivery plan/);
  assert.match(markup, /Decline reviewer request for Prepare the client delivery plan/);
  assert.doesNotMatch(markup, /Accept reviewer request/);
  assert.doesNotMatch(markup, /Withdraw reviewer request/);
  assert.doesNotMatch(markup, /<select/);
  assert.doesNotMatch(markup, /opaque-request-id/);
});

test("resolved requests show outcome and resolution time without exposing decision actions", () => {
  const markup = render({
    reviewerRequests: {
      status: "ready",
      requests: [],
      history: [request({
        status: "accepted",
        resolvedAt: "2026-10-03T14:30:00.000Z",
        canAccept: true,
        canDecline: true,
        canWithdraw: true,
      })],
      loadedRecordCount: 1,
      recordLimit: 100,
    },
  });

  assert.match(markup, /0 pending · 1 resolved/);
  assert.match(markup, /Outcome/);
  assert.match(markup, /Accepted/);
  assert.match(markup, /<time dateTime="2026-10-03T14:30:00\.000Z"/);
  assert.doesNotMatch(markup, /Accept reviewer request|Decline reviewer request|Withdraw reviewer request/);
  assert.doesNotMatch(markup, /Actions for reviewer request/);
});

test("recipient direction and each server action flag map to the correct action set", () => {
  const markup = render({
    handoverRequests: {
      status: "ready",
      requests: [request({ isRecipient: false, canAccept: false, canDecline: false, canWithdraw: true })],
      history: [],
      loadedRecordCount: 1,
      recordLimit: 100,
    },
  });
  assert.match(markup, /Your handover request/);
  assert.match(markup, /Withdraw handover request for Prepare the client delivery plan/);
  assert.doesNotMatch(markup, /Accept handover request/);
  assert.doesNotMatch(markup, /Decline handover request/);
});

test("an all-false capability row gets an explanation and no actions", () => {
  const markup = render({
    reviewerRequests: {
      status: "ready",
      requests: [request({ canAccept: false, canDecline: false, canWithdraw: false })],
      history: [],
      loadedRecordCount: 1,
      recordLimit: 100,
    },
  });
  assert.match(markup, /No action is currently available/);
  assert.doesNotMatch(markup, /Accept reviewer request/);
  assert.doesNotMatch(markup, /Decline reviewer request/);
  assert.doesNotMatch(markup, /Withdraw reviewer request/);
});

test("loaded and endpoint-cap information is honest when the result reaches its cap", () => {
  const markup = render({
    handoverRequests: {
      status: "ready",
      requests: [],
      history: [],
      loadedRecordCount: 100,
      recordLimit: 100,
    },
  });
  assert.match(markup, /Showing 0 pending and 0 resolved requests from 100 actor-scoped records returned/);
  assert.match(markup, /latest 100 actor-scoped requests are returned/);
  assert.match(markup, /older requests involving you may not be included/);
  assert.match(markup, /None are in the 100 actor-scoped records returned/);
});

test("a request deep link identifies and makes only the matching record programmatically focusable", () => {
  const markup = render({
    focusRequest: { kind: "reviewer", id: "opaque-request-id" },
    reviewerRequests: {
      status: "ready",
      requests: [request(), request({ id: "other-request-id", title: "Another task" })],
      history: [],
      loadedRecordCount: 2,
      recordLimit: 100,
    },
  });
  const linkedCard = markup.match(/<article(?=[^>]*data-deep-linked="true")([^>]*)>/);
  assert.ok(linkedCard);
  assert.match(linkedCard[1], /tabindex="-1"/);
  assert.equal((markup.match(/data-deep-linked="true"/g) || []).length, 1);
  assert.match(markup, /Another task/);
  assert.doesNotMatch(markup, /opaque-request-id/);
});

test("a stale or out-of-scope focused request gets a safe unavailable state", () => {
  const markup = render({
    focusRequest: { kind: "handover", id: "missing-request-id" },
    handoverRequests: { status: "ready", requests: [], history: [], loadedRecordCount: 0, recordLimit: 100 },
  });
  assert.match(markup, /This collaboration request is unavailable/);
  assert.match(markup, /resolved or may no longer be available under your current access/);
  assert.doesNotMatch(markup, /Accept handover request|Decline handover request|Withdraw handover request/);
});

test("loading and denied states belong to their own request collection", () => {
  const markup = render({
    reviewerRequests: { status: "loading" },
    handoverRequests: { status: "denied", message: "This endpoint is outside the current grant." },
  });
  assert.match(markup, /Loading reviewer requests/);
  assert.match(markup, /Handover requests are unavailable/);
  assert.match(markup, /This endpoint is outside the current grant\./);
});

test("layout styles define container-based stacked/mobile behavior and wrapped actions", () => {
  const css = fs.readFileSync(path.join(__dirname, "WorkCollaborationRequests.module.css"), "utf8");
  assert.match(css, /container: collaboration/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /@container request-group/);
});
