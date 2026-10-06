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
const { LeaveRequestPanel } = require("./LeaveRequestPanel.tsx");

const baseProps = {
  read: { status: "loading" },
  onRetry: () => {},
  onSubmit: () => {},
  onCancel: () => {},
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(LeaveRequestPanel, { ...baseProps, ...props }));
}

test("leave form preserves names, initial values, constraints, and exact portion choices", () => {
  const markup = render();

  assert.match(markup, /name="leaveType"[^>]*value="annual"/);
  assert.match(markup, /type="date"[^>]*name="startDate"/);
  assert.match(markup, /type="date"[^>]*name="endDate"/);
  assert.match(markup, /name="reason"[^>]*maxLength="2000"/);
  assert.match(markup, /<select tabindex="-1" name="portion">/);
  assert.match(markup, /<option value="1" selected="">Full day<\/option>/);
  assert.match(markup, /<option value="0\.5">Half day<\/option>/);
  assert.match(markup, /Submit leave request/);
});

test("loading and error reads have distinct copy and expose a retry action", () => {
  const loading = render();
  const error = render({ read: { status: "error", message: "The scoped read was denied." } });

  assert.match(loading, /Loading your leave requests/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /The scoped read was denied\./);
  assert.match(error, /Retry loading leave requests/);
  assert.doesNotMatch(error, /No leave requests yet/);
});

test("ready empty state is separate from read failure", () => {
  const markup = render({ read: { status: "ready", requests: [] } });

  assert.match(markup, /No leave requests yet/);
  assert.doesNotMatch(markup, /Retry loading leave requests/);
});

test("ready history renders the full returned list and only eligible cancel actions", () => {
  const requests = Array.from({ length: 120 }, (_unused, index) => ({
    id: `leave-${index}`,
    leaveType: `Request ${index}`,
    status: index === 0 ? "pending" : "approved",
    startDate: "2026-10-05",
    endDate: "2026-10-06",
    canCancel: index === 0,
  }));
  const markup = render({ read: { status: "ready", requests } });

  assert.equal((markup.match(/<li/g) || []).length, 120);
  assert.match(markup, /Request 119/);
  assert.equal((markup.match(/Cancel Request 0 leave request/g) || []).length, 1);
  assert.equal((markup.match(/Cancel request/g) || []).length, 1);
  assert.doesNotMatch(markup, /Cancel Request 1 leave request/);
});

test("a partial row without the server cancel hint remains visible without a cancel action", () => {
  const markup = render({ read: { status: "ready", requests: [{
    id: "leave-partial",
    leaveType: "Annual",
    status: "approved",
    startDate: "2026-10-05",
    endDate: "2026-10-06",
  }] } });

  assert.match(markup, /Annual/);
  assert.doesNotMatch(markup, /Cancel request/);
});

test("component contracts keep API and capability decisions outside this presentation file", () => {
  const componentSource = fs.readFileSync(path.join(__dirname, "LeaveRequestPanel.tsx"), "utf8");
  const contracts = fs.readFileSync(path.join(__dirname, "leave-request-contracts.ts"), "utf8");

  assert.doesNotMatch(componentSource, /fetch\(|\/api\/leave/);
  assert.match(componentSource, /request\.canCancel === true/);
  assert.match(contracts, /portion: LeaveRequestPortion/);
  assert.match(contracts, /onSubmit: \(values: LeaveRequestValues, form: HTMLFormElement\)/);
  assert.match(contracts, /onCancel: \(requestId: string, source: HTMLButtonElement\)/);
});
