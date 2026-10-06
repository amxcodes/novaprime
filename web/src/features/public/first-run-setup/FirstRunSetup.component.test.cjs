const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
require.extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_target, key) => String(key) }); };

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { FirstRunSetup } = require("./FirstRunSetup.tsx");

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(FirstRunSetup, {
    initialPublicOrigin: "https://work.example.test",
    onSubmit() {},
    onCancel() {},
    ...props,
  }));
}

test("setup screen uses labeled reusable controls for all first-run fields", () => {
  const html = render();
  assert.match(html, /Create the founding workspace\./);
  assert.match(html, /Founder account/);
  assert.match(html, /Workspace and attendance/);
  assert.match(html, /Public address and deployment access/);
  assert.match(html, /<input[^>]*autoComplete="name"[^>]*name="name"/);
  assert.match(html, /<input[^>]*autoComplete="organization"[^>]*name="organisationName"/);
  assert.match(html, /<input[^>]*type="email"[^>]*autoComplete="email"[^>]*name="email"/);
  assert.match(html, /<input[^>]*type="password"[^>]*autoComplete="new-password"[^>]*minLength="8"[^>]*name="password"/);
  assert.match(html, /<input[^>]*type="url"[^>]*autoComplete="url"[^>]*name="publicOrigin"/);
  assert.match(html, /<input[^>]*type="password"[^>]*autoComplete="off"[^>]*name="bootstrapToken"/);
  assert.match(html, /<input[^>]*type="number"[^>]*min="1"[^>]*max="1440"[^>]*step="1"[^>]*name="requiredAttendanceMinutes"/);
  assert.match(html, /Create NOVA workspace/);
  assert.match(html, /Cancel/);
});

test("attendance mode is a keyboard-native radio group and minutes start visible and required", () => {
  const html = render();
  assert.match(html, /<fieldset[^>]*aria-invalid="false"/);
  assert.match(html, /<legend[^>]*>Attendance mode/);
  assert.match(html, /type="radio"[^>]*checked=""[^>]*value="hour_based"/);
  assert.match(html, /type="radio"[^>]*value="scheduled"/);
  assert.match(html, /type="radio" required=""/);
  assert.doesNotMatch(html, /<select\b/);
  const source = fs.readFileSync(path.join(__dirname, "FirstRunSetup.tsx"), "utf8");
  assert.match(source, /const requiredMinutes = draft\.attendanceMode === "hour_based"/);
  assert.match(source, /validation\.requiredAttendanceMinutes \?\? 480/);
  assert.match(source, /if \(inFlight\.current\) return/);
  assert.match(source, /disabled=\{submitting\}/);
});

test("confirmed founder resume hides registration credentials and continues with workspace fields", () => {
  const html = render({ resumeFounder: { displayName: "Aman", email: "aman@example.test" } });
  assert.match(html, /Finish workspace setup\./);
  assert.match(html, /Founder account confirmed/);
  assert.match(html, /Signed in as Aman \(aman@example\.test\)/);
  assert.match(html, /Continue workspace setup/);
  assert.match(html, /name="organisationName"/);
  assert.match(html, /name="publicOrigin"/);
  assert.match(html, /name="bootstrapToken"/);
  assert.doesNotMatch(html, /type="email"|name="password"|name="name"/);
  const source = fs.readFileSync(path.join(__dirname, "FirstRunSetup.tsx"), "utf8");
  assert.match(source, /!resumeFounder \? <section className=\{styles\.group\} aria-labelledby=\{`\$\{id\}-founder-heading`\}/);
  assert.match(source, /password: ""/);
});

test("host notice and safe form failures have accessible announcements", () => {
  const html = render({ notice: { kind: "warning", title: "Public URL not saved", message: "Set it before configuring email." } });
  assert.match(html, /Public URL not saved/);
  assert.match(html, /Set it before configuring email\./);
  assert.match(html, /aria-live="polite"/);
  const source = fs.readFileSync(path.join(__dirname, "FirstRunSetup.tsx"), "utf8");
  assert.match(source, /Review the highlighted fields/);
  assert.match(source, /Correct each marked field/);
  assert.match(source, /requestAnimationFrame\(\(\) => focusField\(firstInvalid\)\)/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /If the founder account may already have been created, contact the deployment operator before retrying/);
});

test("component delegates submit/navigation and keeps credentials out of browser persistence and transport", () => {
  const source = fs.readFileSync(path.join(__dirname, "FirstRunSetup.tsx"), "utf8");
  assert.match(source, /await onSubmit\(values\)/);
  assert.match(source, /onClick=\{onCancel\}>Cancel/);
  assert.doesNotMatch(source, /fetch\s*\(|localStorage|sessionStorage|window\.location|history\.|console\.(log|info|warn|error)/);
});

test("responsive styles consume design tokens and cover narrow containers, touch, reduced motion, and forced colors", () => {
  const css = fs.readFileSync(path.join(__dirname, "FirstRunSetup.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
  assert.match(css, /width: min\(100%, 54rem\)/);
  assert.match(css, /container: first-run-setup \/ inline-size/);
  assert.match(css, /@container first-run-setup \(max-width: 42rem\)/);
  assert.match(css, /@container first-run-setup \(max-width: 25rem\)/);
  assert.match(css, /@media \(any-pointer: coarse\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});

test("setup leaves viewport sizing to the public frame and starts the long form at the top", () => {
  const css = fs.readFileSync(path.join(__dirname, "FirstRunSetup.module.css"), "utf8");
  const root = css.match(/\.root\s*\{([^}]*)\}/)?.[1] || "";
  assert.ok(root, "setup root style exists");
  assert.doesNotMatch(root, /min-height|padding-block/);
  assert.match(root, /align-content:\s*start/);
});
