const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

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
const { PublicOrigin } = require("./PublicOrigin.tsx");

function render(readState) {
  return renderToStaticMarkup(React.createElement(PublicOrigin, {
    readState,
    onRetry() {},
    async onSave() {},
  }));
}

test("ready state separates configured choice from effective origin and uses SearchableSelect", () => {
  const html = render({
    status: "ready",
    configuredOrigin: "https://work.example.test",
    effectiveOrigin: "https://work.example.test",
    allowedOrigins: ["https://nova.example.test", "https://work.example.test"],
  });
  assert.match(html, /Canonical NOVA origin/);
  assert.match(html, /Configured choice/);
  assert.match(html, /Effective link origin/);
  assert.match(html, /https:\/\/work\.example\.test/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /Save public origin/);
  assert.doesNotMatch(html, /<select\b/);
});

test("deployment fallback is an explicit empty-string choice", () => {
  const html = render({
    status: "ready",
    configuredOrigin: null,
    effectiveOrigin: "https://fallback.example.test",
    allowedOrigins: ["https://fallback.example.test"],
  });
  assert.match(html, /Configured choice[\s\S]*?Deployment fallback/);
  assert.match(html, /Use deployment fallback/);
  assert.match(html, /Effective link origin[\s\S]*?https:\/\/fallback\.example\.test/);
  assert.match(html, /type="hidden" name="origin" value=""/);
  assert.match(html, /disabled=""/);
});

test("loading and read failure are explicit and error state can be retried", () => {
  const loading = render({ status: "loading" });
  assert.match(loading, /Loading approved origins/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /<select\b/);

  const error = render({ status: "error", message: "Origin access changed." });
  assert.match(error, /Origin settings could not be loaded/);
  assert.match(error, /Origin access changed/);
  assert.match(error, /Try again/);
});

test("save errors keep an origin-only refresh path for stale allowlists", () => {
  const source = fs.readFileSync(path.join(__dirname, "PublicOrigin.tsx"), "utf8");
  assert.match(source, /Refresh approved origins/);
  assert.match(source, /No longer approved/);
  assert.match(source, /!selectedIsAllowed/);
  assert.match(source, /setSaveError\(null\);\s*setSaveSuccess\(null\);\s*onRetry\(\)/);
});

test("responsive styles use semantic tokens, touch targets, and visible focus", () => {
  const css = fs.readFileSync(path.join(__dirname, "PublicOrigin.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
  assert.match(css, /container: public-origin \/ inline-size/);
  assert.match(css, /@container public-origin \(min-width: 44rem\)/);
  assert.match(css, /@container public-origin \(min-width: 64rem\)/);
  assert.match(css, /@container public-origin \(max-width: 40rem\)/);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?--nova-control-touch-target/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});

test("origin form retains its draft across read refreshes and prevents duplicate saves", () => {
  const source = fs.readFileSync(path.join(__dirname, "PublicOrigin.tsx"), "utf8");
  assert.match(source, /if \(readState\.status === "ready" && !selectionDirty\)/);
  assert.match(source, /setSelectionDirty\(value !== currentSelection\)/);
  assert.match(source, /setSelectionDirty\(false\)/);
  assert.match(source, /if \(inFlight\.current \|\| readState\.status !== "ready"\) return/);
  assert.match(source, /Save status could not be confirmed/);
});
