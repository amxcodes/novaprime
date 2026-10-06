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
const { LeaveRequests } = require("./LeaveRequests.tsx");

const ordinaryRequest = {
  id: "leave-ordinary",
  leaveType: "Annual",
  status: "pending",
  startDate: "2026-10-12",
  endDate: "2026-10-14",
  reason: "Family time",
  hasConflict: false,
  canReview: true,
  canResolveConflict: false,
};
const conflictedRequest = {
  ...ordinaryRequest,
  id: "leave-conflict",
  startDate: "2026-10-20",
  endDate: "2026-10-20",
  reason: null,
  hasConflict: true,
  canResolveConflict: true,
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(LeaveRequests, {
    read: { status: "ready", requests: [ordinaryRequest] },
    actions: { status: "idle" },
    onReview() {},
    onResolveConflict() {},
    ...overrides,
  }));
}

test("keeps pending-list loading, denied/unavailable, failure, and empty states distinct", () => {
  assert.match(render({ read: { status: "loading" } }), /Loading leave requests/);
  assert.match(render({ read: { status: "unavailable", message: "Review scope is unavailable." } }), /Review scope is unavailable\./);
  assert.match(render({ read: { status: "error", message: "The request failed." } }), /The request failed\./);
  assert.match(render({ read: { status: "ready", requests: [] } }), /No pending leave requests/);
});

test("notification focus selects a loaded row and falls back to the scoped queue when absent", () => {
  const focused = render({ focusRequestId: ordinaryRequest.id });
  assert.match(focused, /id="leave-request-leave-ordinary"/);
  assert.match(focused, /data-notification-focus="true"/);
  assert.match(focused, /tabindex="-1"/);
  assert.doesNotMatch(focused, /not in the pending list currently available/);

  const missing = render({ focusRequestId: "outside-current-scope" });
  assert.match(missing, /Showing the authorized leave queue/);
  assert.match(missing, /not in the pending list currently available to your review scope/);
  assert.match(missing, /Annual leave/);
  assert.doesNotMatch(render({
    focusRequestId: "leave-ordinary",
    read: { status: "loading" },
  }), /not in the pending list currently available/);

  const empty = render({ focusRequestId: "already-reviewed" , read: { status: "ready", requests: [] } });
  assert.match(empty, /No pending leave requests/);
  assert.match(empty, /linked request is not in the pending list/);
});

test("shows ordinary review actions only for the server-marked eligible row", () => {
  const eligible = render();
  assert.match(eligible, /Annual leave/);
  assert.match(eligible, /Family time/);
  assert.match(eligible, /Approve/);
  assert.match(eligible, /Reject/);
  assert.match(eligible, /role="group" aria-label="Actions for Annual leave"/);
  const ineligible = render({ read: { status: "ready", requests: [{ ...ordinaryRequest, canReview: false }] } });
  assert.match(ineligible, /Review actions unavailable/);
  assert.doesNotMatch(ineligible, /<span>Approve<\/span>|<span>Reject<\/span>/);
});

test("conflicted requests never show ordinary decisions and require the explicit recovery form", () => {
  const eligible = render({ read: { status: "ready", requests: [conflictedRequest] } });
  assert.match(eligible, /Attendance conflict/);
  assert.match(eligible, /Resolve with attendance preserved/);
  assert.match(eligible, /Approve leave; preserve attendance/);
  assert.match(eligible, /Reject leave; preserve attendance/);
  assert.match(eligible, /type="radio"/);
  assert.match(eligible, /name="[^\"]+-decision"/);
  assert.match(eligible, /Resolution note/);
  assert.match(eligible, /required/);
  assert.match(eligible, /maxLength="2000"/);
  assert.match(eligible, /Resolve conflict/);
  assert.doesNotMatch(eligible, /<span>Approve<\/span>|<span>Reject<\/span>/);
});

test("conflicted requests without recovery scope show guidance and no decision controls", () => {
  const html = render({
    read: { status: "ready", requests: [{ ...conflictedRequest, canResolveConflict: false }] },
  });
  assert.match(html, /Attendance recovery access required/);
  assert.doesNotMatch(html, /Resolve with attendance preserved|Resolve conflict|Approve leave; preserve attendance/);
  assert.doesNotMatch(html, /<span>Approve<\/span>|<span>Reject<\/span>/);
});

test("action state stays independent from the pending-list read state", () => {
  const html = render({
    read: { status: "error", message: "Pending list read failed." },
    actions: { status: "feedback", kind: "error", message: "Decision failed and can be retried." },
  });
  assert.match(html, /Pending list read failed\./);
  assert.match(html, /Decision failed and can be retried\./);
});

test("conflict note passes through a host callback only after trim and length validation", () => {
  const source = fs.readFileSync(path.join(__dirname, "LeaveRequests.tsx"), "utf8");
  assert.match(source, /const trimmedNote = note\.trim\(\)/);
  assert.match(source, /onResolveConflict\(decision, trimmedNote\)/);
  assert.match(source, /trimmedNote\.length > 2000/);
  assert.doesNotMatch(source, /fetch\s*\(|axios|api\("/);
});

test("uses semantic tokens, accessible touch controls, and container-based responsive layouts", () => {
  const css = fs.readFileSync(path.join(__dirname, "LeaveRequests.module.css"), "utf8");
  assert.match(css, /container:\s*admin-leave-requests\s*\/\s*inline-size/);
  assert.match(css, /@container admin-leave-requests \(min-width:\s*58rem\)/);
  assert.match(css, /@container admin-leave-requests \(max-width:\s*39\.999rem\)/);
  assert.match(css, /--nova-control-touch-target/);
  assert.match(css, /--nova-color-surface/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.requestItem:focus \.requestCard\s*\{\s*outline:\s*2px solid Highlight;/s);
});

test("conflict radio focus has one row-owned focus ring", () => {
  const css = fs.readFileSync(path.join(__dirname, "LeaveRequests.module.css"), "utf8");
  assert.match(css, /\.decisionOption:has\(input:focus-visible\)\s*\{\s*outline:\s*2px solid var\(--nova-color-focus\)/s);
  assert.match(css, /\.decisionOption:has\(input:focus-visible\) input\s*\{\s*outline:\s*none;/s);
  assert.match(css, /:global\(:focus-visible\):not\(input\[type="checkbox"\]\):not\(input\[type="radio"\]\)/);
});
