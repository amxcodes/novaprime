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
const { AppShell } = require("./AppShell.tsx");
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
    onToggleCompact() {},
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

test("desktop rail toggle exposes the same supplied destinations in expanded and compact states", () => {
  const groups = [
    { id: "core", label: "Workspace", items: [
      { id: "home", label: "Home", href: "/", icon: null },
      { id: "work", label: "Work", href: "/work", icon: null },
    ] },
    { id: "admin", label: "Configuration", items: [
      { id: "settings", label: "Settings", href: "/settings", icon: null },
    ] },
  ];
  const props = {
    activeItemId: "work",
    brand: "NOVA",
    groups,
    navigationId: "test-desktop-navigation",
    onToggleCompact() {},
  };
  const expanded = renderToStaticMarkup(React.createElement(DesktopSidebar, {
    ...props,
    compact: false,
  }));
  const compact = renderToStaticMarkup(React.createElement(DesktopSidebar, {
    ...props,
    compact: true,
  }));

  assert.match(expanded, /aria-label="Collapse sidebar navigation"/);
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(compact, /aria-label="Expand sidebar navigation"/);
  assert.match(compact, /aria-expanded="false"/);
  assert.match(expanded, /aria-controls="test-desktop-navigation"/);
  assert.match(compact, /id="test-desktop-navigation"/);
  assert.match(expanded, /<h2[^>]*>Workspace<\/h2>/);
  assert.match(compact, /<h2[^>]*>Workspace<\/h2>/);
  assert.match(compact, />Home<\/span>/);
  assert.match(compact, /title="Home"/);
  assert.match(compact, /title="Settings"/);

  const destinations = (markup) => Array.from(markup.matchAll(/<a\b[^>]*href="([^"]+)"/g), ([, href]) => href);
  assert.deepEqual(destinations(expanded), ["/", "/work", "/settings"]);
  assert.deepEqual(destinations(compact), destinations(expanded));
});

test("exposes only supplied navigation in quick links and wires More to the complete authorized drawer", () => {
  const markup = renderToStaticMarkup(React.createElement(AppShell, {
    brand: "NOVA",
    navigation: [{ id: "core", label: "Workspace", items: [
      { id: "home", label: "Home", href: "/", icon: null },
      { id: "people", label: "People", href: "/people", icon: null },
    ] }],
    activeItemId: "people",
    currentPageLabel: "People",
    mobilePrimaryIds: ["missing-feature", "people", "home"],
    children: React.createElement("p", null, "Directory"),
  }));

  assert.match(markup, /aria-label="Quick navigation"/);
  assert.match(markup, /aria-current="page" class="bottomLink" href="\/people"/);
  assert.match(markup, /class="bottomLink" href="\/"/);
  assert.match(markup, /aria-label="Navigation"/);
  assert.match(markup, /data-navigation-state="expanded"/);
  assert.match(markup, /aria-label="Collapse sidebar navigation"/);
  assert.match(markup, /aria-controls="nova-navigation-[^"]+-desktop"/);
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /More/);
  assert.doesNotMatch(markup, /missing-feature|secret-feature/);
});
