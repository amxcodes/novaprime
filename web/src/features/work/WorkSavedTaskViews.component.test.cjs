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
const { WorkSavedTaskViews } = require("./WorkSavedTaskViews.tsx");

const firstView = {
  id: "view-mine",
  name: "Overdue design work",
  collection: "mine",
  status: "in_progress",
  due: "overdue",
  search: "design",
  revision: 3,
};

const secondView = { ...firstView, id: "view-mine-2", name: "Ready tasks" };

const baseProps = {
  views: [firstView, secondView, { ...firstView, id: "view-visible", name: "Other collection", collection: "visible" }],
  collection: "mine",
  filters: { status: "all", due: "today", search: "design" },
  readStatus: "ready",
  availableCollections: ["mine"],
  atLimit: false,
  onOpen() {},
  onCreate() {},
  onUpdate() {},
  onRetry() {},
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WorkSavedTaskViews, { ...baseProps, ...props }));
}

test("saved-view picker renders the selected current-collection value and retains its form name", () => {
  const html = render();

  assert.match(html, /<span id="[^"]+"><span>Open a saved view<\/span>/);
  assert.match(html, /<button[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
  assert.match(html, /<select tabindex="-1" name="savedViewId">[\s\S]*?<option value="view-mine" selected="">Overdue design work/);
  assert.doesNotMatch(html, /Other collection/);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/i);
});

test("loading, error, and empty states withhold the saved-view picker", () => {
  const loading = render({ readStatus: "loading" });
  const error = render({ readStatus: "error" });
  const empty = render({ views: [] });

  assert.match(loading, /Loading saved views/);
  assert.doesNotMatch(loading, /aria-haspopup="listbox"/);
  assert.match(error, /Saved views could not be loaded/);
  assert.match(error, /Retry/);
  assert.doesNotMatch(error, /aria-haspopup="listbox"/);
  assert.match(empty, /No saved views for this task list yet/);
  assert.doesNotMatch(empty, /aria-haspopup="listbox"/);
});

test("pending saved-view actions disable the authored picker and open control", () => {
  const html = render({ pendingAction: "open" });

  assert.match(html, /<button(?=[^>]*aria-haspopup="listbox")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<button(?=[^>]*aria-label="Opening saved view")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /Opening…/);
});

test("the twelve-view limit only blocks creating another view", () => {
  const views = Array.from({ length: 12 }, (_, index) => ({ ...firstView, id: `view-${index}`, name: `View ${index + 1}` }));
  const html = render({ views, atLimit: true });

  assert.match(html, /<button[^>]*aria-haspopup="listbox"/);
  assert.match(html, /Delete a saved view in Settings to make room/);
  assert.match(html, /<input(?=[^>]*name="name")(?=[^>]*disabled="")[^>]*>/);
});

test("saved-view creation disclosure keeps native details semantics with a tokenized chevron", () => {
  const html = render();
  const css = fs.readFileSync(`${__dirname}/WorkSavedTaskViews.module.css`, "utf8");

  assert.match(html, /<details><summary>Save current filters<\/summary>/);
  assert.match(css, /\.createDisclosure summary\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\)[^}]*list-style:\s*none/s);
  assert.match(css, /\.createDisclosure summary::marker\s*\{\s*content:\s*"";\s*\}/);
  assert.match(css, /\.createDisclosure summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.createDisclosure summary::after\s*\{[^}]*border-inline-end:\s*1\.5px solid currentColor[^}]*transition:\s*transform var\(--nova-motion-duration-fast\) var\(--nova-motion-ease-standard\)/s);
  assert.match(css, /\.createDisclosure\[open\] summary::after\s*\{[^}]*rotate\(225deg\)/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.createDisclosure summary::after\s*\{\s*border-color:\s*currentColor;/);
  assert.match(css, /\.createDisclosure summary:focus-visible\s*\{\s*outline-color:\s*Highlight;\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.createDisclosure summary::after\s*\{\s*transition:\s*none;/);
});
