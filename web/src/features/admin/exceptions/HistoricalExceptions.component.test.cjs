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
const {
  HistoricalExceptions,
  validateHistoricalExceptionAuditNote,
} = require("./HistoricalExceptions.tsx");

const exception = {
  id: "exception-1",
  code: "attendance.clock_adjustment",
  businessDate: "2026-10-01",
  status: "open",
  sourceType: "attendance_record",
  sourceId: "attendance-42",
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(HistoricalExceptions, {
    capabilities: { view: true, resolve: true },
    read: { status: "ready", exceptions: [exception] },
    onResolve() {},
    ...props,
  }));
}

test("view capability gates list rendering independently from resolve access", () => {
  const denied = render({
    capabilities: { view: false, resolve: true },
    read: { status: "ready", exceptions: [exception] },
  });
  assert.match(denied, /do not have access to view this organisation list/);
  assert.doesNotMatch(denied, /attendance\.clock_adjustment|attendance-42|Close exception/);

  const viewOnly = render({ capabilities: { view: true, resolve: false } });
  assert.match(viewOnly, /attendance\.clock_adjustment/);
  assert.match(viewOnly, /View only/);
  assert.doesNotMatch(viewOnly, /<form|Close exception|name=".*outcome/);
});

test("renders loading, denied, read-error, and empty states distinctly", () => {
  const loading = render({ read: { status: "loading" } });
  assert.match(loading, /Loading historical exceptions/);
  assert.doesNotMatch(loading, /attendance\.clock_adjustment/);

  const denied = render({ read: { status: "denied", message: "Permission was revoked." } });
  assert.match(denied, /Permission was revoked\./);

  const error = render({ read: { status: "error", message: "Refresh the page to retry\." } });
  assert.match(error, /could not load/);
  assert.match(error, /Refresh the page to retry\./);

  const empty = render({ read: { status: "empty" } });
  assert.match(empty, /No historical exceptions/);
  assert.doesNotMatch(empty, /<form/);
});

test("resolve form requires an audited note with the API's 2,000-character limit", () => {
  const html = render();
  assert.match(html, /attendance\.clock_adjustment/);
  assert.match(html, /<fieldset[^>]*>/);
  assert.match(html, /<input[^>]*type="radio"[^>]*value="resolved"/);
  assert.match(html, /<input[^>]*type="radio"[^>]*value="dismissed"/);
  assert.match(html, /<textarea[^>]*required=""?[^>]*maxLength="2000"/);
  assert.match(html, /Audit note/);
  assert.match(html, /Close exception/);
  assert.doesNotMatch(html, /<select/);
});

test("leave attendance conflicts explain the required workflow without a generic close action", () => {
  const conflict = {
    ...exception,
    id: "exception-leave-conflict",
    code: "availability.leave_attendance_conflict",
  };
  const html = render({ read: { status: "ready", exceptions: [conflict] } });
  assert.match(html, /must be resolved by approving or rejecting its linked leave request/);
  assert.match(html, /cannot be dismissed as a generic exception/);
  assert.doesNotMatch(html, /Open linked leave request|<form|type="radio"|Close exception|<select/);
});

test("closed exceptions are read-only and show the saved note when supplied", () => {
  const html = render({
    capabilities: { view: true, resolve: true },
    read: { status: "ready", exceptions: [{ ...exception, status: "dismissed", resolutionNote: "Duplicate record verified." }] },
  });
  assert.match(html, /Dismissed/);
  assert.match(html, /Duplicate record verified\./);
  assert.doesNotMatch(html, /<form|Close exception/);
});

test("a closed leave conflict shows its stored resolution without open-conflict guidance", () => {
  const html = render({
    capabilities: { view: true, resolve: true },
    read: {
      status: "ready",
      exceptions: [{
        ...exception,
        code: "availability.leave_attendance_conflict",
        status: "resolved",
        resolutionNote: "Approved from the linked leave request.",
      }],
    },
  });
  assert.match(html, /Resolved/);
  assert.match(html, /Approved from the linked leave request\./);
  assert.doesNotMatch(html, /must be resolved by approving|Open linked leave request|Close exception/);
});

test("whitespace-only audit-note validation focuses the field after describing its error", () => {
  let error = "";
  let focused = false;
  const callbacks = [];
  const noteRef = { current: { focus() { focused = true; } } };
  const result = validateHistoricalExceptionAuditNote(
    "  \n  ",
    noteRef,
    (message) => { error = message; },
    (callback) => { callbacks.push(callback); return callbacks.length; },
  );

  assert.equal(result, null);
  assert.match(error, /Enter an audit note from 1 to 2,000 characters/);
  assert.equal(focused, false);
  assert.equal(callbacks.length, 1);
  callbacks[0](0);
  assert.equal(focused, true);

  const source = fs.readFileSync(path.join(__dirname, "HistoricalExceptions.tsx"), "utf8");
  assert.match(source, /validateHistoricalExceptionAuditNote\(note, noteRef, setNoteError, requestAnimationFrame\)/);
  assert.match(source, /<textarea\s+ref=\{noteRef\}[\s\S]*?aria-invalid=\{noteError \? true : undefined\}[\s\S]*?aria-describedby=\{noteError \? `\$\{noteErrorId\} \$\{id\}-note-count`/);
  assert.match(source, /<p className=\{styles\.fieldError\} id=\{noteErrorId\}>\{noteError\}<\/p>/);
  assert.doesNotMatch(source, /role="alert"[^>]*>\{noteError\}/);
});

test("resolution feedback avoids state updates after the protected host refresh unmounts the card", () => {
  const source = fs.readFileSync(path.join(__dirname, "HistoricalExceptions.tsx"), "utf8");
  assert.match(source, /const mountedRef = useRef\(false\)/);
  assert.match(source, /mountedRef\.current = true;\s*return \(\) => \{\s*mountedRef\.current = false;/);
  assert.match(source, /await onResolve\(exception\.id, outcome, trimmed\);\s*if \(!mountedRef\.current\) return;/);
  assert.match(source, /catch \(error\) \{\s*if \(!mountedRef\.current\) return;/);
  assert.match(source, /finally \{\s*if \(mountedRef\.current\) \{\s*actionLock\.current = false;\s*setPending\(false\);/);
});
