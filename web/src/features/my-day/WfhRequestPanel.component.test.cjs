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
const { WfhRequestPanel } = require("./WfhRequestPanel.tsx");

const baseProps = {
  read: { status: "loading" },
  onRetry: () => {},
  onSubmit: () => {},
  onCancel: () => {},
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WfhRequestPanel, { ...baseProps, ...props }));
}

test("WFH form retains the API field names, required dates, and reason limit", () => {
  const markup = render();

  assert.match(markup, /<input[^>]*required=""[^>]*type="date"[^>]*name="startDate"/);
  assert.match(markup, /<input[^>]*required=""[^>]*type="date"[^>]*name="endDate"/);
  assert.match(markup, /name="reason"[^>]*maxLength="2000"/);
  assert.match(markup, /Submit WFH request/);
});

test("request history distinguishes loading, failed reads with retry, and ready-empty", () => {
  const loading = render();
  const error = render({ read: { status: "error", message: "Your access changed." } });
  const empty = render({ read: { status: "ready", requests: [] } });

  assert.match(loading, /Loading your WFH requests/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /Your access changed\./);
  assert.match(error, /Retry loading WFH requests/);
  assert.doesNotMatch(error, /No WFH requests yet/);
  assert.match(empty, /No WFH requests yet/);
  assert.doesNotMatch(empty, /Retry loading WFH requests/);
});

test("ready state shows Cancel only for rows whose server projection allows it", () => {
  const requests = [
    { id: "pending-id", startDate: "2026-10-05", endDate: "2026-10-05", status: "pending", canCancel: true },
    { id: "approved-id", startDate: "2026-10-06", endDate: "2026-10-07", status: "approved", canCancel: true },
    { id: "expired-id", startDate: "2026-10-01", endDate: "2026-10-02", status: "pending", canCancel: false },
    { id: "attended-id", startDate: "2026-10-08", endDate: "2026-10-08", status: "approved", canCancel: false },
    { id: "rejected-id", startDate: "2026-10-09", endDate: "2026-10-09", status: "rejected", reviewReason: "Coverage required", canCancel: false },
    { id: "cancelled-id", startDate: "2026-10-10", endDate: "2026-10-10", status: "cancelled", canCancel: false },
  ];
  const markup = render({ read: { status: "ready", requests } });

  assert.equal((markup.match(/<li/g) || []).length, requests.length);
  assert.match(markup, /2026-10-10/);
  assert.match(markup, /Coverage required/);
  assert.equal((markup.match(/Cancel WFH request,/g) || []).length, 2);
  assert.match(markup, /Cancel WFH request, 2026-10-05 to 2026-10-05/);
  assert.match(markup, /Cancel WFH request, 2026-10-06 to 2026-10-07/);
  assert.doesNotMatch(markup, /Cancel WFH request, 2026-10-01 to 2026-10-02/);
  assert.doesNotMatch(markup, /Cancel WFH request, 2026-10-08 to 2026-10-08/);
});

test("missing cancel hint fails closed even when request status is pending or approved", () => {
  const markup = render({ read: { status: "ready", requests: [
    { id: "legacy-pending", startDate: "2026-10-05", endDate: "2026-10-05", status: "pending" },
    { id: "legacy-approved", startDate: "2026-10-06", endDate: "2026-10-07", status: "approved" },
  ] } });

  assert.doesNotMatch(markup, /Cancel WFH request,/);
});

test("component keeps transport outside presentation and implements pending submit/cancel feedback", () => {
  const component = fs.readFileSync(path.join(__dirname, "WfhRequestPanel.tsx"), "utf8");
  const contracts = fs.readFileSync(path.join(__dirname, "wfh-request-contracts.ts"), "utf8");

  assert.doesNotMatch(component, /fetch\(|\/api\/availability/);
  assert.match(component, /const \[submitting, setSubmitting\] = useState\(false\)/);
  assert.match(component, /disabled=\{submitting\}/);
  assert.match(component, /loading=\{submitting\}/);
  assert.match(component, /const pendingCancels = useRef\(new Set<string>\(\)\)/);
  assert.match(component, /loading=\{cancelling\}/);
  assert.match(component, /request\.canCancel === true/);
  assert.match(contracts, /startDate: string;[\s\S]*?endDate: string;[\s\S]*?reason: string;/);
  assert.match(contracts, /onCancel: \(requestId: string, source: HTMLButtonElement\)/);
});

test("feature styles adapt from one-column phone forms to wider module containers", () => {
  const css = fs.readFileSync(path.join(__dirname, "WfhRequestPanel.module.css"), "utf8");

  assert.match(css, /container: wfh-request \/ inline-size/);
  assert.match(css, /\.form \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@container wfh-request \(min-width: 40rem\)/);
  assert.match(css, /:focus-visible/);
  const buttonStyles = fs.readFileSync(path.join(__dirname, "../../design-system/primitives/Button.module.css"), "utf8");
  const fieldStyles = fs.readFileSync(path.join(__dirname, "../../design-system/primitives/Field.module.css"), "utf8");
  assert.match(buttonStyles, /@media \(any-pointer: coarse\)/);
  assert.match(fieldStyles, /@media \(any-pointer: coarse\)/);
});
