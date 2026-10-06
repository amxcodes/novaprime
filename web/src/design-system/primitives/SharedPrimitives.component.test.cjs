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
const { Avatar } = require("./Avatar.tsx");
const { SegmentedControl } = require("./SegmentedControl.tsx");
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
  const badge = renderToStaticMarkup(React.createElement(Badge, { tone: "warning" }, "Needs review"));
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
  assert.match(badge, /Needs review/);
  assert.match(empty, /<h2[^>]*>No records yet<\/h2>/);
  assert.match(empty, /New records will appear here/);
  assert.match(empty, /Create record/);
  assert.match(pageHeader, /<h2[^>]*>Directory<\/h2>/);
  assert.match(pageHeader, /People/);
  assert.match(pageHeader, /Add person/);
  assert.match(sectionHeading, /<h3[^>]*>Current members<\/h3>/);
});

test("segmented choices expose their label, selected state, and disabled state", () => {
  const html = renderToStaticMarkup(React.createElement(SegmentedControl, {
    "aria-label": "Task layout",
    value: "list",
    options: [
      { value: "list", label: "List" },
      { value: "board", label: "Board", disabled: true },
    ],
    onValueChange() {},
  }));

  assert.match(html, /<div[^>]*role="group" aria-label="Task layout"/);
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*><span>List<\/span><\/button>/);
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*disabled=""><span>Board<\/span><\/button>/);
});

test("avatars have an accessible identity only when the containing context needs one", () => {
  const decorative = renderToStaticMarkup(React.createElement(Avatar, { size: 32 }));
  const named = renderToStaticMarkup(React.createElement(Avatar, { size: 48, accessibleName: "Morgan Lee" }));

  assert.match(decorative, /data-size="32" aria-hidden="true"><svg/);
  assert.match(named, /data-size="48" role="img" aria-label="Morgan Lee"><svg/);
  assert.match(named, /<circle/);
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
  const segmentedControl = readCss("SegmentedControl");
  const avatar = readCss("Avatar");
  const emptyState = readCss("EmptyState");
  const pageHeader = readCss("PageHeader");
  const stateMessage = readCss("StateMessage");

  for (const [name, css] of Object.entries({ button, field, badge, segmentedControl, avatar, emptyState, pageHeader, stateMessage })) {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${name} should use themeable semantic color tokens`);
  }
  assert.match(field, /\.control:focus-visible\s*\{[^}]*var\(--nova-control-border-focus\)/s);
  assert.match(field, /\.control:focus-visible\s*\{[^}]*caret-color:\s*var\(--nova-color-action\);[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/s);
  assert.match(field, /\.control\[aria-invalid="true"\]:focus-visible\s*\{[^}]*var\(--nova-color-danger\)/s);
  assert.match(field, /\.control\[aria-invalid="true"\]:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-danger\)/s);
  assert.match(field, /@media \(any-pointer: coarse\)\s*\{\s*\.control\s*\{[^}]*var\(--nova-control-touch-target\)/s);
  assert.match(field, /\.label\s*\{[^}]*font-size:\s*var\(--nova-type-size-control-label\)/s);
  assert.match(field, /\.control\s*\{[^}]*font-size:\s*var\(--nova-type-size-body\)/s);
  assert.match(field, /\.control\s*\{[^}]*padding:\s*0 calc\(var\(--nova-space-4\) - 1px\)/s);
  assert.match(field, /\.hint,\s*\.error\s*\{[^}]*font-size:\s*var\(--nova-type-size-detail\)/s);
  assert.match(button, /@media \(any-pointer: coarse\)/);
  assert.match(pageHeader, /@media \(max-width: 47\.999rem\)/);
  assert.match(badge, /\.badge\[data-tone="info"\]\s*\{\s*color:\s*var\(--nova-color-action-text\);\s*background:\s*var\(--nova-color-surface-subtle\)/s);
  assert.match(badge, /var\(--nova-color-(?:success|warning|danger)-surface\)/);
  assert.match(badge, /min-height:\s*1\.75rem/);
  assert.match(badge, /border-radius:\s*var\(--nova-radius-status\)/);
  assert.match(badge, /font-size:\s*var\(--nova-type-size-detail\)/);
  assert.doesNotMatch(badge, /\.dot|::before/);
  assert.match(segmentedControl, /container-type:\s*inline-size/);
  assert.match(segmentedControl, /min-height:\s*2rem/);
  assert.match(segmentedControl, /border-radius:\s*var\(--nova-radius-control\)/);
  assert.match(segmentedControl, /\.group\s*\{[^}]*border:\s*1px solid var\(--nova-color-control-edge-quiet\)[^}]*border-radius:\s*var\(--nova-radius-control\)[^}]*background:\s*var\(--nova-color-control-fill-quiet\)/s);
  assert.match(segmentedControl, /\.group\s*\{[^}]*gap:\s*var\(--nova-space-2\)[^}]*padding:\s*3px/s);
  assert.match(segmentedControl, /\.option\s*\{[^}]*min-width:\s*10rem[^}]*min-height:\s*2rem[^}]*border-radius:\s*var\(--nova-radius-status\)/s);
  assert.match(segmentedControl, /\.option\[data-selected="true"\]::before\s*\{[^}]*inset-block-start:\s*1px[^}]*inset-inline:\s*8%[^}]*height:\s*1px[^}]*opacity:\s*var\(--nova-control-highlight-opacity\)/s);
  assert.match(segmentedControl, /\.option\s*\{[^}]*font-size:\s*var\(--nova-type-size-control-label\)[^}]*font-weight:\s*var\(--nova-type-weight-regular\)[^}]*line-height:\s*var\(--nova-type-line-control\)/s);
  assert.match(segmentedControl, /\.option\[data-selected="true"\]\s*\{[^}]*border-color:\s*var\(--nova-color-action-edge\)[^}]*color:\s*var\(--nova-color-action-contrast\)[^}]*background:\s*var\(--nova-color-action\)/s);
  assert.doesNotMatch(segmentedControl, /linear-gradient|\.group::before/);
  assert.match(segmentedControl, /\.option:focus-visible\s*\{\s*outline:\s*none;[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/s);
  assert.match(segmentedControl, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.option:focus-visible\s*\{[^}]*outline:\s*1px solid Highlight/);
  assert.match(segmentedControl, /@container segmented-control \(max-width:\s*22rem\)/);
  assert.match(stateMessage, /\.message\[data-kind="info"\]\s*\{[^}]*var\(--nova-color-info-surface\)/s);
  assert.match(emptyState, /@media \(max-width: 639px\)/);
});
