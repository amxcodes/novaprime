const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

require.extensions[".tsx"] = (module, filename) => {
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

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { default: SelectPoc } = require("./SelectPoc.tsx");

test("React Aria select exposes a labeled required form value and a disabled option", () => {
  const html = renderToStaticMarkup(React.createElement(SelectPoc));

  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /aria-describedby="[^"]+"/);
  assert.match(html, /data-required="true"/);
  assert.match(html, /name="workspace"/);
  assert.match(html, /value="operations" selected=""/);
  assert.match(html, /Default workspace/);
  assert.match(html, /Finance analytics/);
  assert.match(html, /disabled=""/);
  assert.match(html, /data-disabled="true"/);
  assert.match(html, /Managed workspace/);
  assert.match(html, /Only an administrator can change this value\./);
});

test("experiment styling consumes NOVA semantic tokens without hard-coded colors", () => {
  const css = fs.readFileSync(path.join(__dirname, "SelectPoc.module.css"), "utf8");

  assert.match(css, /var\(--nova-select-popup-background\)/);
  assert.match(css, /var\(--nova-color-action\)/);
  assert.match(css, /var\(--nova-control-touch-target\)/);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?\.trigger,[\s\S]*?\.secondaryButton\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\);/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
