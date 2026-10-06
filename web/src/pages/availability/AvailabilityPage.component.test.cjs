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
  const classNames = new Proxy({}, { get: (_target, key) => String(key) });
  module.exports = { __esModule: true, default: classNames };
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AvailabilityPage } = require("./AvailabilityPage.tsx");

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(AvailabilityPage, {
    agenda: {
      startDate: "",
      endDate: "",
      sourceLabels: ["scheduled shifts"],
      loadEvents: async () => ({ events: [] }),
      updateRange() {},
      isCurrentPageRequest: () => true,
      readErrorMessage: () => "Availability could not load.",
      businessTimeLabel: (value) => value,
      ...props,
    },
  }));
}

test("owns the route heading and feedback target while composing the existing agenda once", () => {
  const markup = render();

  assert.equal((markup.match(/<h1\b/g) || []).length, 1);
  assert.match(markup, /<section[^>]*aria-label="Availability"/);
  assert.match(markup, /<h1[^>]*>People and office calendar<\/h1>/);
  assert.match(markup, /schedule, holiday, attendance, leave, and work-from-home records your current grants allow/);
  assert.match(markup, /<p id="feedback" class="notice feedback" role="status" hidden=""><\/p>/);
  assert.equal((markup.match(/aria-label="Availability agenda"/g) || []).length, 1);
  assert.match(markup, /Business date from/);
  assert.match(markup, /Business date to/);
});

test("keeps agenda behavior and responsive styling inside their feature boundary", () => {
  const pageSource = fs.readFileSync(path.join(__dirname, "AvailabilityPage.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "AvailabilityPage.module.css"), "utf8");

  assert.match(pageSource, /<AvailabilityAgenda \{\.\.\.agenda\} \/>/);
  assert.match(pageSource, /<PageHeader/);
  assert.doesNotMatch(pageSource, /useState|loadEvents\(|nextCursor/);
  assert.match(css, /container: availability-page \/ inline-size/);
  assert.match(css, /@container availability-page \(max-width: 60rem\)/);
  assert.match(css, /@container availability-page \(max-width: 40rem\)/);
  assert.match(css, /var\(--nova-color-border\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|:global\(\.agenda\)|rangeForm|overflow-(?:x|y):\s*(?:auto|scroll)/i);
});
