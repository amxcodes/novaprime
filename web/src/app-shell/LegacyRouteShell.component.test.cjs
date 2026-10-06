const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../server/node_modules/typescript");

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
  const styles = new Proxy({}, { get: (_target, key) => typeof key === "string" ? key : "" });
  module.exports = { __esModule: true, default: styles };
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { LegacyRouteShell } = require("./LegacyRouteShell.tsx");
const { DesktopSidebar } = require("./Navigation.tsx");

function render(children) {
  return renderToStaticMarkup(React.createElement(LegacyRouteShell, {
    children,
    destinations: [{ id: "home", label: "Home", group: "Core", href: "/" }],
    activeItemId: "home",
    displayName: "Aman",
    currentPageLabel: "Home",
    unreadCount: 0,
    onNavigate: () => {},
  }));
}

test("renders route body as typed children and escapes string content instead of injecting markup", () => {
  const childMarkup = render(React.createElement("div", { id: "route-owned-root" }, "Route content"));
  assert.match(childMarkup, /data-legacy-route-body="true"><div id="route-owned-root">Route content<\/div><\/div>/);

  const hostileText = '<img src=x onerror="alert(1)">';
  const stringMarkup = render(hostileText);
  assert.ok(stringMarkup.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.doesNotMatch(stringMarkup, /<img\b/);

  const source = fs.readFileSync(path.join(__dirname, "LegacyRouteShell.tsx"), "utf8");
  assert.doesNotMatch(source, /bodyHtml|dangerouslySetInnerHTML/);
});

test("keeps the existing route mount targets and status copy as fixed React elements", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  for (const [id, view] of [
    ["settings-page-root", "settings"],
    ["admin-console", "admin"],
    ["invite-page-root", "invite"],
    ["notifications-root", "notifications"],
    ["my-day-page-root", "today"],
    ["work-route-root", "work"],
    ["work-setup-page-root", "work-setup"],
    ["people-page-root", "people"],
  ]) {
    assert.ok(app.includes(`renderShell(createElement("div", { id: "${id}" }), "${view}")`), `${view} mount target remains in its shell`);
  }

  assert.match(app, /id: "availability-content"[\s\S]*?Loading Availability agenda…/);
  assert.match(app, /id: "operations-board"[\s\S]*?Loading Operations reports…/);
  assert.doesNotMatch(app, /createElement\("section", \{ className: "panel" \}/);
  assert.match(app, /mountReactIsland\(target, RouteUnavailablePage/);
  assert.doesNotMatch(app, /renderShell\(\s*['"`]/);
});

test("keeps the header notification action at the standard shell control size", () => {
  const markup = render(React.createElement("span", null, "Route content"));
  assert.match(markup, /data-nav="notifications"[^>]*data-size="default"/);
});

test("omits empty navigation groups and preserves authorized destination order and active state", () => {
  const markup = renderToStaticMarkup(React.createElement(DesktopSidebar, {
    brand: "NOVA",
    activeItemId: "work",
    groups: [
      { id: "empty", label: "Empty group", items: [] },
      { id: "core", label: "My workspace", items: [
        { id: "home", label: "Home", href: "/", icon: null },
        { id: "work", label: "Work", href: "/work", icon: null },
      ] },
      { id: "admin", label: "Configuration", items: [
        { id: "settings", label: "Settings", href: "/settings", icon: null },
      ] },
    ],
  }));

  assert.doesNotMatch(markup, /Empty group/);
  assert.ok(markup.indexOf("My workspace") < markup.indexOf("Configuration"));
  assert.match(markup, /aria-current="page"[^>]*href="\/work"/);
});
