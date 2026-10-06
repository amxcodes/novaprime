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
const { OperationsPage } = require("./OperationsPage.tsx");

function render(overview = {}) {
  return renderToStaticMarkup(React.createElement(OperationsPage, {
    overview: {
      onRetry() {},
      personHistoryHref: (personId) => `/?view=people&person=${personId}`,
      onViewPersonHistory() {},
      taskDetailHref: (taskId) => `/?view=work&task=${taskId}`,
      onOpenTask() {},
      ...overview,
    },
  }));
}

test("owns the route heading and feedback target while composing the typed overview once", () => {
  const markup = render({ people: { status: "loading", query: "" } });

  assert.equal((markup.match(/<h1\b/g) || []).length, 1);
  assert.match(markup, /<section[^>]*aria-label="Operations"/);
  assert.match(markup, /<h1[^>]*>Operations<\/h1>/);
  assert.match(markup, /Scoped reports and tools are shown only when their source permissions allow them\./);
  assert.match(markup, /<p id="feedback" class="notice feedback" role="status" hidden=""><\/p>/);
  assert.equal((markup.match(/class="overview"/g) || []).length, 1);
  assert.match(markup, /Loading people/);
});

test("keeps route framing responsive and theme-token based", () => {
  const pageSource = fs.readFileSync(path.join(__dirname, "OperationsPage.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "OperationsPage.module.css"), "utf8");

  assert.match(pageSource, /overview: OperationsOverviewProps/);
  assert.match(pageSource, /<OperationsOverview \{\.\.\.overview\} \/>/);
  assert.match(pageSource, /<PageHeader/);
  assert.doesNotMatch(pageSource, /useState|loadEvents\(|canShow|planOperationsReads/);
  assert.match(css, /container: operations-page \/ inline-size/);
  assert.match(css, /@container operations-page \(max-width: 60rem\)/);
  assert.match(css, /@container operations-page \(max-width: 40rem\)/);
  assert.match(css, /\.content\s*>\s*\*\s*\{\s*min-width:\s*0;\s*\}/);
  assert.match(css, /\.feedback\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /var\(--nova-color-border\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|:global\(\.overview\)|\.reportGrid|overflow-(?:x|y):\s*(?:auto|scroll)/i);
});
