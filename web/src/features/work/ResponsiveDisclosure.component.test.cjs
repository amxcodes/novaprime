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
const { ResponsiveDisclosure } = require("./ResponsiveDisclosure.tsx");

test("compact layout renders a closed native disclosure with a labeled filter count", () => {
  const html = renderToStaticMarkup(React.createElement(ResponsiveDisclosure, {
    label: "Filters",
    compact: true,
    activeCount: 2,
    children: React.createElement("button", { type: "button" }, "Apply filters"),
  }));

  assert.match(html, /<details[^>]*aria-label="Filters"[^>]*>/);
  assert.match(html, /<summary[^>]*><span>Filters<\/span><span[^>]*>2 active<\/span><\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open=""/);
  assert.match(html, /Apply filters/);
  assert.doesNotMatch(html, /role="menu"|role="menuitem"/);
});

test("expanded layout exposes the same disclosure content inline", () => {
  const html = renderToStaticMarkup(React.createElement(ResponsiveDisclosure, {
    label: "More actions",
    compact: false,
    children: React.createElement("button", { type: "button" }, "Board"),
  }));

  assert.match(html, /<details[^>]*aria-label="More actions"[^>]*open=""/);
  assert.match(html, /Board/);
});

test("responsive disclosure styles use semantic tokens and native focus states", () => {
  const css = fs.readFileSync(path.join(__dirname, "ResponsiveDisclosure.module.css"), "utf8");
  assert.match(css, /@container \(max-width:\s*40rem\)/);
  assert.match(css, /\.summary:focus-visible/);
  assert.match(css, /\(any-pointer:\s*coarse\)/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/i);
});
