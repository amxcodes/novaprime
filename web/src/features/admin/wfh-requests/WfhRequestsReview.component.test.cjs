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
const { WfhRequestsReview, shouldRestoreDeclineTriggerFocus } = require("./WfhRequestsReview.tsx");

const request = {
  id: "request-1",
  startDate: "2026-10-05",
  endDate: "2026-10-06",
  reason: "Plumber visit at home.",
  canReview: true,
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WfhRequestsReview, {
    readEligibility: { allowed: true },
    actionEligibility: { allowed: true },
    readState: { status: "ready", requests: [request] },
    onReview() {},
    ...props,
  }));
}

test("read ineligibility takes precedence and never renders supplied request details", () => {
  const html = render({
    readEligibility: { allowed: false, message: "Request access is unavailable." },
    readState: { status: "ready", requests: [{ ...request, reason: "private note sentinel" }] },
  });

  assert.match(html, /Pending WFH requests are unavailable/);
  assert.match(html, /Request access is unavailable\./);
  assert.doesNotMatch(html, /private note sentinel|Approve|Decline/);
});

test("loading and read errors stay distinct while retaining the feature heading", () => {
  const loading = render({ readState: { status: "loading" } });
  assert.match(loading, /WFH request review/);
  assert.match(loading, /Loading pending WFH requests/);
  assert.match(loading, /role="status"/);

  const error = render({ readState: { status: "error", message: "Try again later." } });
  assert.match(error, /Pending WFH requests could not load/);
  assert.match(error, /Try again later\./);
  assert.doesNotMatch(error, /No pending WFH requests/);

  const unavailable = render({ readState: { status: "unavailable", message: "The prerequisite review access is unavailable." } });
  assert.match(unavailable, /Pending WFH requests are unavailable/);
  assert.match(unavailable, /The prerequisite review access is unavailable\./);
  assert.match(unavailable, /data-kind="warning"/);
  assert.doesNotMatch(unavailable, /could not load|Try again later/);
});

test("notification focus targets a loaded row and safely falls back when it is absent", () => {
  const focused = render({ focusRequestId: request.id });
  assert.match(focused, /id="wfh-request-request-1"/);
  assert.match(focused, /data-notification-focus="true"/);
  assert.match(focused, /tabindex="-1"/);

  const missing = render({ focusRequestId: "outside-current-scope" });
  assert.match(missing, /Showing the authorized WFH queue/);
  assert.match(missing, /not in the pending list currently available to your review scope/);
  assert.match(missing, /Plumber visit at home/);
  assert.doesNotMatch(render({
    focusRequestId: request.id,
    readState: { status: "loading" },
  }), /not in the pending list currently available/);

  const empty = render({ focusRequestId: "already-reviewed", readState: { status: "ready", requests: [] } });
  assert.match(empty, /No pending WFH requests/);
  assert.match(empty, /linked request is not in the pending list/);
});

test("ready requests show readable dates and safe projected content without identity or raw fields", () => {
  const html = render({
    readState: {
      status: "ready",
      requests: [{
        ...request,
        personId: "private-person-id",
        reviewerPersonId: "private-reviewer-id",
        reviewReason: "private historical reason",
        internalAudit: { token: "raw-private-data" },
      }],
    },
  });

  assert.match(html, /WFH request review/);
  assert.match(html, /dateTime="2026-10-05"/);
  assert.match(html, /dateTime="2026-10-06"/);
  assert.doesNotMatch(html, /Date unavailable/);
  assert.match(html, /Pending/);
  assert.match(html, /Plumber visit at home\./);
  assert.doesNotMatch(html, /private-person-id|private-reviewer-id|private historical reason|raw-private-data/);
});

test("read-only eligibility keeps request details visible and removes all decision controls", () => {
  const html = render({
    actionEligibility: { allowed: false, message: "Decision access is not available." },
  });

  assert.match(html, /Decision access is not available\./);
  assert.match(html, /Plumber visit at home\./);
  assert.doesNotMatch(html, />Approve<|>Decline<|Confirm decline/);
});

test("row-level server eligibility gates actions independently of global action eligibility", () => {
  const html = render({
    readState: { status: "ready", requests: [{ ...request, canReview: false }] },
  });

  assert.match(html, /not marked it eligible for your review/);
  assert.doesNotMatch(html, />Approve<|>Decline<|Confirm decline/);
});

test("eligible rows preserve optional decline reason semantics and the API limit", () => {
  const html = render();

  assert.match(html, />Approve</);
  assert.match(html, />Decline</);
  assert.match(html, /Reason for declining/);
  assert.match(html, /\(optional\)/);
  assert.match(html, /maxLength="2000"/);
  assert.match(html, /An explanation is optional/);
  assert.match(html, /hidden=""/);
});

test("only the row with an active decision shows busy state; other rows are locked without a spinner", () => {
  const source = fs.readFileSync(path.join(__dirname, "WfhRequestsReview.tsx"), "utf8");
  assert.match(source, /busy=\{busyId === request\.id\}/);
  assert.match(source, /blocked=\{busyId !== null && busyId !== request\.id\}/);
  assert.match(source, /loading=\{busy && pendingDecision === "approved"\}/);
  assert.match(source, /loading=\{busy && pendingDecision === "rejected"\}/);
  assert.doesNotMatch(source, /loading=\{busy\}/);
  assert.match(source, /disabled=\{busy \|\| blocked/);
});

test("decline close returns focus only when the active control is inside the closing form", () => {
  const inside = {};
  const outside = {};
  const form = { contains: (candidate) => candidate === inside };
  assert.equal(shouldRestoreDeclineTriggerFocus(form, inside), true);
  assert.equal(shouldRestoreDeclineTriggerFocus(form, outside), false);
  assert.equal(shouldRestoreDeclineTriggerFocus(null, inside), false);

  const source = fs.readFileSync(path.join(__dirname, "WfhRequestsReview.tsx"), "utf8");
  assert.match(source, /shouldRestoreDeclineTriggerFocus\(\s*declineFormRef\.current,\s*document\.activeElement/s);
  assert.match(source, /declineTriggerRef\.current\?\.focus\(\)/);
  assert.match(source, /onClick=\{closeDeclineForm\}/);
  assert.match(source, /await onReview\(request\.id, command\);\s*closeDeclineForm\(\)/);
});

test("empty results do not fabricate pending work or decision controls", () => {
  const html = render({ readState: { status: "ready", requests: [] } });

  assert.match(html, /No pending WFH requests/);
  assert.match(html, /0 requests in this view/);
  assert.doesNotMatch(html, /<ol|<form|Approve|Decline/);
});

test("feature layout adapts to its container and uses theme, touch, and forced-color tokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "WfhRequestsReview.module.css"), "utf8");
  assert.match(css, /container: admin-wfh-review \/ inline-size/);
  assert.match(css, /@container admin-wfh-review \(min-width: 40rem\)/);
  assert.match(css, /@container admin-wfh-review \(max-width: 39\.999rem\)/);
  assert.match(css, /min-height: var\(--nova-control-touch-target\)/);
  assert.match(css, /var\(--nova-color-surface\)/);
  assert.match(css, /var\(--nova-color-text-primary\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.requestList > li:focus \.request\s*\{\s*outline:\s*2px solid Highlight;/s);
});

test("contract contains only projected summaries and accepts host-owned decision callbacks", () => {
  const source = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.match(source, /id: string/);
  assert.match(source, /canReview: boolean/);
  assert.match(source, /reason\?: string/);
  assert.match(source, /onReview: \(requestId: string, command: WfhRequestReviewCommand\)/);
  assert.doesNotMatch(source, /personId|reviewerPersonId|details\??:|permissionKey|grants/);
});
