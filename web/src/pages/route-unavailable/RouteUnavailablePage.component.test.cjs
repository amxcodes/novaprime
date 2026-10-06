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
  module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { RouteUnavailablePage } = require("./RouteUnavailablePage.tsx");

function render(accessUnresolved) {
  return renderToStaticMarkup(React.createElement(RouteUnavailablePage, {
    label: "Operations",
    accessUnresolved,
    onReturnToWorkspace() {},
  }));
}

test("distinguishes unverified access from a confirmed unavailable destination", () => {
  const unresolved = render(true);
  assert.match(unresolved, /Access could not be checked\./);
  assert.match(unresolved, /Refresh the page after your connection is restored\./);
  assert.doesNotMatch(unresolved, /Your current permissions do not include/);

  const denied = render(false);
  assert.match(denied, /This feature is not available to your account\./);
  assert.match(denied, /Ask an authorized workspace administrator/);
  assert.doesNotMatch(denied, /Access could not be checked\./);
});

test("provides one route heading, feedback target, and an explicit workspace action", () => {
  const markup = render(false);
  assert.equal((markup.match(/<h1\b/g) || []).length, 1);
  assert.match(markup, /<p class="[^\"]*eyebrow[^\"]*">Operations<\/p>/);
  assert.match(markup, /id="feedback"[^>]*role="status" hidden=""/);
  assert.match(markup, /<button[^>]*data-variant="secondary"[^>]*>.*Go to your workspace/s);
});

test("keeps the route layout responsive and entirely driven by NOVA theme tokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "RouteUnavailablePage.module.css"), "utf8");
  const page = css.match(/\.page\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(page, /container:\s*unavailable-page\s*\/\s*inline-size/);
  assert.match(page, /width:\s*100%;/);
  assert.match(page, /min-width:\s*0;/);
  assert.match(css, /@container unavailable-page \(max-width: 60rem\)/);
  assert.match(css, /@container unavailable-page \(max-width: 40rem\)/);
  assert.match(css, /var\(--nova-color-border\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
});

test("host retains the route grant gate and delegates only visible page composition", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const gate = host.indexOf('if (!canOpenView(view)) {');
  const protectedRoute = host.indexOf('if (view === "today") return renderAttendance(lifetime);');
  const unavailableStart = host.indexOf("function renderUnavailableView(view)");
  const unavailableEnd = host.indexOf("\nfunction workspaceHomeView()", unavailableStart);
  const unavailable = host.slice(unavailableStart, unavailableEnd);

  assert.ok(gate >= 0 && protectedRoute > gate, "the route access gate runs before protected route renderers");
  assert.match(host.slice(gate, protectedRoute), /return renderUnavailableView\(view\)/);
  assert.ok(unavailableStart >= 0 && unavailableEnd > unavailableStart);
  assert.match(unavailable, /mountReactIsland\(target, RouteUnavailablePage/);
  assert.match(unavailable, /onReturnToWorkspace:\s*\(\) => go\(workspaceHomeView\(\)\)/);
  assert.match(unavailable, /showFeedback\(\);[\s\S]*restorePendingRouteScroll\(\);/);
  assert.doesNotMatch(unavailable, /api\(|createElement\("(?:section|h1|p|button)"/);
});
