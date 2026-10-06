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
const { Field, Input } = require("./Field.tsx");
const { Badge } = require("./Badge.tsx");
const { EmptyState } = require("./EmptyState.tsx");
const { PageHeader, SectionHeading } = require("./PageHeader.tsx");
const { Loading, StateMessage } = require("./StateMessage.tsx");

test("Field connects required state, hints, errors, and its input accessibly", () => {
  const html = renderToStaticMarkup(React.createElement(Field, {
    id: "work-email",
    label: "Work email",
    hint: "Use your organisation address.",
    error: "Enter a valid email.",
    required: true,
  }, (control) => React.createElement(Input, { ...control, type: "email", name: "email" })));

  assert.match(html, /<label[^>]*for="work-email"[^>]*>.*Work email/s);
  assert.match(html, /<input[^>]*id="work-email"[^>]*aria-describedby="work-email-hint work-email-error"[^>]*aria-invalid="true"[^>]*required=""[^>]*type="email"/);
  assert.match(html, /id="work-email-hint"/);
  assert.match(html, /id="work-email-error"/);
});

test("status, empty state, and headings keep their semantic content in the rendered markup", () => {
  const badge = renderToStaticMarkup(React.createElement(Badge, { tone: "warning", showDot: true }, "Needs review"));
  const empty = renderToStaticMarkup(React.createElement(EmptyState, {
    title: "No records yet",
    description: "New records will appear here.",
    action: React.createElement("button", null, "Create record"),
  }));
  const pageHeader = renderToStaticMarkup(React.createElement(PageHeader, {
    level: 2,
    eyebrow: "People",
    title: "Directory",
    description: "Manage the people in your scope.",
    actions: React.createElement("button", null, "Add person"),
  }));
  const sectionHeading = renderToStaticMarkup(React.createElement(SectionHeading, { level: 3, title: "Current members" }));

  assert.match(badge, /data-tone="warning"/);
  assert.match(badge, /aria-hidden="true"/);
  assert.match(badge, /Needs review/);
  assert.match(empty, /<h2[^>]*>No records yet<\/h2>/);
  assert.match(empty, /New records will appear here/);
  assert.match(empty, /Create record/);
  assert.match(pageHeader, /<h2[^>]*>Directory<\/h2>/);
  assert.match(pageHeader, /People/);
  assert.match(pageHeader, /Add person/);
  assert.match(sectionHeading, /<h3[^>]*>Current members<\/h3>/);
});

test("error messages are alerts while loading messages announce a busy status", () => {
  const error = renderToStaticMarkup(React.createElement(StateMessage, { kind: "error", title: "Could not save" }, "Try again."));
  const loading = renderToStaticMarkup(React.createElement(Loading, { label: "Loading people" }));

  assert.match(error, /role="alert"/);
  assert.match(error, /aria-live="assertive"/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading people/);
});

test("shared primitive styles consume semantic appearance tokens and support responsive controls", () => {
  const readCss = (name) => fs.readFileSync(require.resolve(`./${name}.module.css`), "utf8");
  const button = readCss("Button");
  const field = readCss("Field");
  const badge = readCss("Badge");
  const emptyState = readCss("EmptyState");
  const pageHeader = readCss("PageHeader");
  const stateMessage = readCss("StateMessage");

  for (const [name, css] of Object.entries({ button, field, badge, emptyState, pageHeader, stateMessage })) {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${name} should use themeable semantic color tokens`);
  }
  assert.match(field, /\.control:focus-visible\s*\{[^}]*var\(--nova-control-border-focus\)/s);
  assert.match(field, /\.control\[aria-invalid="true"\]:focus-visible\s*\{[^}]*var\(--nova-color-danger\)/s);
  assert.match(field, /@media \(any-pointer: coarse\)\s*\{\s*\.control\s*\{[^}]*var\(--nova-control-touch-target\)/s);
  assert.match(button, /@media \(any-pointer: coarse\)/);
  assert.match(pageHeader, /@media \(max-width: 47\.999rem\)/);
  assert.match(badge, /var\(--nova-color-(?:success|warning|danger|info)-surface\)/);
  assert.match(stateMessage, /\.message\[data-kind="info"\]\s*\{[^}]*var\(--nova-color-info-surface\)/s);
  assert.match(emptyState, /@media \(max-width: 639px\)/);
});
