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
const { Button, IconButton } = require("./Button.tsx");

test("Button keeps native button semantics while IconButton exposes its required accessible name", () => {
  const regular = renderToStaticMarkup(React.createElement(Button, { type: "submit" }, "Save changes"));
  const icon = renderToStaticMarkup(React.createElement(IconButton, { "aria-label": "Close panel" }, React.createElement("svg", { "aria-hidden": "true" })));

  assert.match(regular, /<button type="submit"[^>]*data-variant="primary"[^>]*>.*Save changes/s);
  assert.match(icon, /<button[^>]*aria-label="Close panel"[^>]*data-variant="quiet"[^>]*data-size="default"/);
});

test("forced-colors keeps disabled button text at the selected system color", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const forcedColorsCss = css.slice(css.indexOf("@media (forced-colors: active)"));
  const disabledRule = forcedColorsCss.match(/\.button:disabled\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(disabledRule, /color:\s*GrayText/);
  assert.match(disabledRule, /border-color:\s*GrayText/);
  assert.match(disabledRule, /opacity:\s*1/);
});

test("coarse-pointer sizing keeps compact buttons and icon buttons at the touch target token", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const coarsePointerCss = css.slice(css.indexOf("@media (any-pointer: coarse)"));

  assert.match(coarsePointerCss, /\.button,\s*\.button\[data-size="compact"\]\s*\{\s*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(coarsePointerCss, /\.iconButton,\s*\.iconButton\[data-size="compact"\]\s*\{\s*width:\s*var\(--nova-control-touch-target\)/);
});
