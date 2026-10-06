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

test("Figma button geometry and typography are expressed through the shared controls and font system", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const base = css.match(/\.button\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(base, /min-height:\s*var\(--nova-control-height\)/);
  assert.match(base, /border-radius:\s*var\(--nova-radius-control\)/);
  assert.match(base, /font-size:\s*var\(--nova-type-size-control-label,\s*11px\)/);
  assert.match(base, /font-weight:\s*var\(--nova-type-weight-medium\)/);
  assert.match(base, /line-height:\s*var\(--nova-type-line-control,\s*14px\)/);
  assert.match(css, /padding:\s*0 var\(--nova-space-3\)/);
  assert.doesNotMatch(css, /linear-gradient/);
});

test("primary, quiet, hover, pressed, and danger visuals use the Orbit semantic state tokens", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const primary = css.match(/\.button\[data-variant="primary"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  const quiet = css.match(/\.button\[data-variant="secondary"\],\s*\.button\[data-variant="quiet"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  const hover = css.match(/\.button\[data-variant="secondary"\]:hover:not\(:disabled\),\s*\.button\[data-variant="quiet"\]:hover:not\(:disabled\)\s*\{([^}]+)\}/)?.[1] ?? "";
  const pressed = css.match(/\.button\[data-variant="secondary"\]:active:not\(:disabled\),\s*\.button\[data-variant="quiet"\]:active:not\(:disabled\)\s*\{([^}]+)\}/)?.[1] ?? "";
  const danger = css.match(/\.button\[data-variant="danger"\]\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(primary, /border-color:\s*var\(--nova-color-action-edge\)/);
  assert.match(primary, /color:\s*var\(--nova-color-action-contrast\)/);
  assert.match(primary, /background:\s*var\(--nova-color-action\)/);
  assert.match(quiet, /border-color:\s*var\(--nova-color-control-edge-quiet\)/);
  assert.match(quiet, /background:\s*var\(--nova-color-control-fill-quiet\)/);
  assert.match(hover, /border-color:\s*var\(--nova-color-control-edge-hover\)/);
  assert.match(hover, /background:\s*var\(--nova-color-control-fill-hover\)/);
  assert.match(pressed, /border-color:\s*var\(--nova-color-control-edge-pressed\)/);
  assert.match(pressed, /background:\s*var\(--nova-color-control-fill-pressed\)/);
  assert.match(danger, /border-color:\s*var\(--nova-color-danger-edge\)/);
  assert.match(danger, /color:\s*var\(--nova-color-danger\)/);
  assert.match(danger, /background:\s*var\(--nova-color-danger-surface\)/);
});

test("Figma highlight pebble, focus underline, disabled treatment, and high-contrast mode remain available", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const highlight = css.match(/\.button::before\s*\{([^}]+)\}/)?.[1] ?? "";
  const underline = css.match(/\.button::after\s*\{([^}]+)\}/)?.[1] ?? "";
  const disabled = css.match(/\.button:disabled\s*\{([^}]+)\}/)?.[1] ?? "";
  const forcedDisabled = css.slice(css.indexOf("@media (forced-colors: active)")).match(/\.button:disabled\s*\{([^}]+)\}/)?.[1] ?? "";
  const forcedColorsCss = css.slice(css.indexOf("@media (forced-colors: active)"));
  const reducedMotionCss = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@media (forced-colors: active)"));

  assert.match(highlight, /inset-block-start:\s*1px/);
  assert.match(highlight, /inset-inline:\s*8%/);
  assert.match(highlight, /background:\s*var\(--nova-color-control-highlight\)/);
  assert.match(highlight, /opacity:\s*var\(--nova-control-highlight-opacity\)/);
  assert.match(css, /\.button:active:not\(:disabled\)::before\s*\{\s*opacity:\s*0/);
  assert.match(underline, /inset-block-end:\s*4px/);
  assert.match(underline, /width:\s*28px/);
  assert.match(underline, /height:\s*1px/);
  assert.match(underline, /background:\s*var\(--nova-color-focus\)/);
  assert.match(css, /\.button:focus-visible::after\s*\{\s*opacity:\s*1/);
  assert.match(disabled, /background:\s*var\(--nova-color-control-fill-disabled\)/);
  assert.match(disabled, /border-color:\s*var\(--nova-color-control-edge-disabled\)/);
  assert.match(disabled, /color:\s*var\(--nova-color-text-muted\)/);
  assert.match(forcedColorsCss, /\.button:focus-visible\s*\{\s*outline:\s*1px solid Highlight/);
  assert.match(forcedColorsCss, /\.button::before\s*\{\s*display:\s*none/);
  assert.match(forcedDisabled, /color:\s*GrayText/);
  assert.match(forcedDisabled, /border-color:\s*GrayText/);
  assert.match(reducedMotionCss, /\.spinner\s*\{[^}]*animation:\s*none/s);
  assert.doesNotMatch(css, /\.button:disabled\s*\{[^}]*opacity:/s);
});

test("button motion stays restrained and stops for reduced-motion users", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const base = css.match(/\.button\s*\{([^}]+)\}/)?.[1] ?? "";
  const reducedMotionCss = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@media (forced-colors: active)"));

  assert.match(base, /transform var\(--nova-motion-duration-fast\) var\(--nova-motion-ease-standard\)/);
  assert.match(css, /\.button:hover:not\(:disabled\)\s*\{\s*transform:\s*translateY\(-1px\)/);
  assert.match(css, /\.button:active:not\(:disabled\)\s*\{\s*transform:\s*scale\(0\.98\)/);
  assert.match(reducedMotionCss, /\.button:hover:not\(:disabled\),\s*\.button:active:not\(:disabled\)\s*\{\s*transform:\s*none/);
});

test("coarse-pointer sizing keeps compact and icon buttons at the touch target token", () => {
  const css = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const coarsePointerCss = css.slice(css.indexOf("@media (any-pointer: coarse)"));

  assert.match(coarsePointerCss, /\.button,\s*\.button\[data-size="compact"\]\s*\{\s*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(coarsePointerCss, /\.iconButton,\s*\.iconButton\[data-size="compact"\]\s*\{\s*width:\s*var\(--nova-control-touch-target\)/);
});
