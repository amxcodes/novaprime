const assert = require("node:assert/strict");
const fs = require("node:fs");
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
const { AttendancePolicySettings } = require("./AttendancePolicySettings.tsx");

const currentPolicy = { mode: "hour_based", requiredAttendanceMinutes: 480, effectiveOn: "2026-09-01" };

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(AttendancePolicySettings, {
    access: { status: "visible", manage: "allowed" },
    read: { status: "ready", policy: currentPolicy },
    onSchedule() {},
    ...props,
  }));
}

test("hidden feature does not render policy details or mutation controls", () => {
  const html = render({ access: { status: "hidden" } });
  assert.equal(html, "");
});

test("view-only access reads the policy without exposing the scheduling form", () => {
  const html = render({ access: { status: "visible", manage: "denied" } });
  assert.match(html, /Attendance policy/);
  assert.match(html, /Current policy/);
  assert.match(html, /480 minutes/);
  assert.match(html, /View access only/);
  assert.doesNotMatch(html, /<form|Schedule policy|Effective from/);
});

test("manager sees accessible policy choices, blank effective date, and server-aligned limits", () => {
  const html = render();
  assert.match(html, /Required duration/);
  assert.match(html, /Assigned schedule/);
  assert.match(html, /<fieldset[^>]*><legend>Attendance calculation<\/legend>/);
  assert.match(html, /<label[^>]*for="[^"]+-minutes"[^>]*><span>Required attendance minutes<\/span>/);
  assert.match(html, /type="number"[^>]*min="1"[^>]*max="1440"[^>]*step="1"/);
  assert.match(html, /Effective from/);
  assert.match(html, /type="date"[^>]*value=""/);
  assert.match(html, /Schedule policy/);
});

test("scheduled mode replaces the duration field with its calendar explanation", () => {
  const html = render({
    read: { status: "ready", policy: { ...currentPolicy, mode: "scheduled" } },
  });
  assert.match(html, /Configure shifts and working calendars in Availability/);
  assert.doesNotMatch(html, /Required attendance minutes/);
});

test("policy synchronization resets only when ready server policy contents change", () => {
  const source = fs.readFileSync(require("node:path").join(__dirname, "AttendancePolicySettings.tsx"), "utf8");
  assert.match(source, /attendancePolicyReadChanged\(lastAppliedPolicyKey\.current, readyPolicyKey\)/);
  assert.match(source, /setDraft\(attendancePolicyDraft\(currentPolicy\)\)/);
  assert.match(source, /setFieldErrors\(\{\}\)/);
});

test("scheduled mode switch has a valid fallback for the API-required hidden duration", () => {
  const source = fs.readFileSync(require("node:path").join(__dirname, "AttendancePolicySettings.tsx"), "utf8");
  assert.match(source, /selectAttendancePolicyMode\(/);
  assert.match(source, /requiredAttendanceMinutes: undefined/);
});

test("does not update local mutation state after the host refresh unmounts the feature", () => {
  const source = fs.readFileSync(require("node:path").join(__dirname, "AttendancePolicySettings.tsx"), "utf8");
  assert.match(source, /const mounted = useRef\(false\)/);
  assert.match(source, /return \(\) => \{ mounted\.current = false; \}/);
  assert.match(source, /if \(mounted\.current\) setFeedback\(/);
  assert.match(source, /if \(mounted\.current\) setPending\(false\)/);
});

test("current-policy loading, unavailable, and error reads remain distinct", () => {
  assert.match(render({ read: { status: "loading" } }), /Loading attendance policy/);
  const unavailable = render({ read: { status: "unavailable", message: "Permission required." } });
  assert.match(unavailable, /Permission required\./);
  assert.match(unavailable, /Scheduling is unavailable/);
  assert.doesNotMatch(unavailable, /<form|Schedule policy|Effective from/);

  const failed = render({ read: { status: "error", message: "Organisation read failed." } });
  assert.match(failed, /Organisation read failed\./);
  assert.match(failed, /Scheduling is unavailable/);
  assert.doesNotMatch(failed, /<form|Schedule policy|Effective from/);
});

test("feature layout and controls use semantic tokens and responsive accessible states", () => {
  const css = fs.readFileSync(require("node:path").join(__dirname, "AttendancePolicySettings.module.css"), "utf8");
  assert.match(css, /@container attendance-policy \(min-width: 42rem\)/);
  assert.match(css, /@container attendance-policy \(max-width: 41\.999rem\)/);
  assert.match(css, /--nova-control-touch-target/);
  assert.match(css, /--nova-color-surface/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(forced-colors: active\)/);
});
