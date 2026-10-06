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

test("disabled button colors retain their semantic contrast in forced-colors mode", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const forcedColorsCss = css.slice(css.indexOf("@media (forced-colors: active)"));
  const disabledRule = forcedColorsCss.match(/\.button:disabled\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(disabledRule, /color:\s*GrayText/);
  assert.match(disabledRule, /border-color:\s*GrayText/);
  assert.doesNotMatch(css, /\.button:disabled\s*\{[^}]*opacity:/s);
});

test("loading buttons expose busy state and retain an accessible name", () => {
  const html = renderToStaticMarkup(React.createElement(Button, {
    loading: true,
    loadingLabel: "Saving changes",
    "aria-label": "Save changes",
  }, "Save"));

  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-label="Saving changes"/);
  assert.match(html, /<span aria-hidden="true"><\/span>/);
});

test("quiet and danger actions use the Orbit system's light, semantic surfaces", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const quiet = css.match(/\.button\[data-variant="quiet"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  const danger = css.match(/\.button\[data-variant="danger"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  const dangerHover = css.match(/\.button\[data-variant="danger"\]:hover:not\(:disabled\)\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(quiet, /border-color:\s*var\(--nova-color-border\)/);
  assert.match(quiet, /background:\s*var\(--nova-color-surface\)/);
  assert.match(danger, /border-color:\s*color-mix\(in srgb, var\(--nova-color-danger\)/);
  assert.match(danger, /color:\s*var\(--nova-color-danger\)/);
  assert.match(danger, /background:\s*var\(--nova-color-danger-surface\)/);
  assert.match(dangerHover, /border-color:\s*var\(--nova-color-danger\)/);
  assert.match(dangerHover, /background:\s*color-mix\(in srgb, var\(--nova-color-danger\)/);
  assert.doesNotMatch(dangerHover, /filter:/);
});

test("button motion and keyboard focus follow the design-system cues without motion under reduced-motion", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  assert.match(css, /\.button:hover:not\(:disabled\)\s*\{\s*transform:\s*translateY\(-1px\)/);
  assert.match(css, /\.button:active:not\(:disabled\)\s*\{\s*transform:\s*translateY\(0\)/);
  assert.match(css, /\.button:focus-visible\s*\{\s*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/);
  const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@media (forced-colors: active)"));
  assert.match(reducedMotion, /\.spinner\s*\{[^}]*animation:\s*none/);
});

test("coarse-pointer sizing keeps compact buttons and icon buttons at the touch target token", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const coarsePointerCss = css.slice(css.indexOf("@media (any-pointer: coarse)"));

  assert.match(coarsePointerCss, /\.button,\s*\.button\[data-size="compact"\]\s*\{\s*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(coarsePointerCss, /\.iconButton,\s*\.iconButton\[data-size="compact"\]\s*\{\s*width:\s*var\(--nova-control-touch-target\)/);
});
