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
const { SettingsPage } = require("./SettingsPage.tsx");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(SettingsPage, {
    canManagePublicOrigin: true,
    canManageEmail: true,
    canShowAuthHandoffs: true,
    ...overrides,
  }));
}

test("owns the Settings page heading and keeps personal and operator features in a stable route order", () => {
  const markup = render();
  assert.equal((markup.match(/<h1\b/g) || []).length, 1);
  assert.match(markup, /<h1[^>]*><span id="settings-page-title">Settings<\/span><\/h1>/);
  assert.match(markup, /id="feedback" class="notice [^"]+" role="status" hidden=""/);
  const ids = [
    "account-security", "appearance", "workspace", "notification-preferences",
    "public-origin", "email-delivery", "auth-handoffs",
  ];
  const positions = ids.map((id) => markup.indexOf(`data-settings-slot="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(markup, /data-settings-subslot="saved-task-views"/);
  assert.match(markup, /Secure system handoffs/);
  assert.doesNotMatch(markup, /<main\b|class="panel/);
});

test("omits each operator feature and its mount target when the host does not authorize it", () => {
  for (const key of ["public-origin", "email-delivery", "auth-handoffs"]) {
    const props = {
      canManagePublicOrigin: key !== "public-origin",
      canManageEmail: key !== "email-delivery",
      canShowAuthHandoffs: key !== "auth-handoffs",
    };
    const markup = render(props);
    assert.doesNotMatch(markup, new RegExp(`data-settings-slot="${key}"`));
    const rootId = key === "public-origin" ? "public-origin-root"
      : key === "email-delivery" ? "email-delivery-root" : "auth-handoffs-root";
    assert.doesNotMatch(markup, new RegExp(`id="${rootId}"`));
    assert.match(markup, /data-settings-slot="account-security"/);
  }
});

test("omits the administrative separator when no operator-only section is available", () => {
  const markup = render({
    canManagePublicOrigin: false,
    canManageEmail: false,
    canShowAuthHandoffs: false,
  });
  assert.doesNotMatch(markup, /data-settings-group="administrative"/);
});

test("uses one-column, container-responsive composition without taking over content-frame width", () => {
  const source = fs.readFileSync(path.join(__dirname, "SettingsPage.module.css"), "utf8");
  assert.match(source, /container:\s*settings-page \/ inline-size/);
  const pageRule = source.match(/\.page\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(pageRule, /width:\s*100%;/);
  assert.match(pageRule, /min-width:\s*0;/);
  assert.doesNotMatch(pageRule, /max-width:|padding-inline:|margin-inline:/);
  assert.match(source, /\.sections\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(source, /@container settings-page \(max-width: 60rem\)/);
  assert.match(source, /@container settings-page \(max-width: 40rem\)/);
  assert.match(source, /var\(--nova-color-border\)/);
  assert.doesNotMatch(source, /overflow-x:\s*(?:auto|scroll)/);
});

test("keeps API, permission, and request-lifetime ownership in the legacy route adapter", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "../../../app/settings-page-route.js"), "utf8");
  const start = host.indexOf("async function renderSettings(lifetime)");
  const end = host.indexOf("\nasync function mountSettingsNotificationPreferences(", start);
  const settings = host.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(settings, /import\("\.\/app\/settings-page-route\.js"\)/);
  assert.match(settings, /capabilities: \{ canManagePublicOrigin, canManageEmail, canShowAuthHandoffs \}/);
  assert.match(settings, /const canManageEmail = state\.actorGrants\?\.isSuperAdmin === true/);
  assert.match(settings, /const canManagePublicOrigin = Boolean\(state\.bootstrapToken\) \|\|\s*hasPermissionGrant\(state\.actorGrants, "organisation\.public_origin\.manage"\)/);
  assert.match(settings, /const canShowAuthHandoffs = handoffAccess\.bootstrap \|\|\s*\(\s*handoffAccess\.canRead && canViewAuthHandoffs\(state\.actorGrants\)/);
  assert.match(settings, /const isCurrentSettings = \(\) => isCurrentPageRequest\(lifetime\) && state\.identityEpoch === settingsIdentityEpoch/);
  assert.match(settings, /mountAccountSecurity: mountSettingsAccountSecurity/);
  assert.match(settings, /mountNotificationPreferences: \(target, isCurrent\) => mountSettingsNotificationPreferences\(target, isCurrent, lifetime\)/);
  assert.match(settings, /renderAppearance: renderAppearanceEditor/);
  assert.match(settings, /updateWorkspace: \(\) => \{ void updateWorkspaceEditor\(\); \}/);
  assert.match(settings, /mountPublicOrigin: mountSettingsPublicOrigin/);
  assert.match(settings, /mountAuthHandoffs: mountSettingsAuthHandoffs/);
  assert.match(route, /import\("\.\.\/src\/pages\/settings\/SettingsPage\.tsx"\)/);
  assert.match(route, /mountIsland\(target, SettingsPage, capabilities\)/);
  assert.match(route, /sections\.mountAccountSecurity\(accountSecurityRoot, isCurrentSettings\)/);
  assert.match(route, /sections\.mountNotificationPreferences\(notificationPreferencesRoot, isCurrentSettings\)/);
  assert.match(route, /sections\.mountPublicOrigin\(originRoot, isCurrentSettings, originBridge\)/);
  assert.match(route, /sections\.mountEmailDelivery\(/);
  assert.match(route, /sections\.mountAuthHandoffs\(authHandoffsRoot, isCurrentSettings\)/);
  assert.match(route, /if \(!isCurrentSettings\(\)\) return (?:true|false)/);
  assert.match(host, /import \{ mountSettingsEmailDeliveryRoute \} from "\.\/app\/settings-email-delivery-route\.js"/);
  assert.match(host, /import \{ mountSettingsPublicOriginRoute \} from "\.\/app\/settings-public-origin-route\.js"/);
  assert.match(settings, /canReadOrigin,\s*canActWithUnknownPublicOrigin,\s*originBridge/);
  assert.match(route, /canActWithUnknownPublicOrigin: capabilities\.canManageEmail && !capabilities\.canManagePublicOrigin/);
  assert.match(settings, /handoffAccess\.bootstrap \|\|/);

  const originStart = host.indexOf("function mountSettingsPublicOrigin(");
  const originEnd = host.indexOf("\nfunction mountSettingsAuthHandoffs(", originStart);
  const originHost = host.slice(originStart, originEnd);
  assert.ok(originStart >= 0 && originEnd > originStart);
  assert.match(originHost, /readOrigin:\s*\(\)\s*=>\s*api\("\/api\/organisation\/public-origin", state\.bootstrapToken/);
  assert.match(originHost, /requestOptions\("GET", undefined, \{ "x-nova-bootstrap-token": state\.bootstrapToken \}\)/);
  assert.match(originHost, /saveOrigin:\s*\(origin\)\s*=>\s*api\("\/api\/organisation\/public-origin", requestOptions\(/);
  assert.match(originHost, /"PATCH",\s*\{ origin \}/);
  assert.match(originHost, /publishOriginSnapshot\(snapshot\)/);
  assert.doesNotMatch(originHost, /host:\s*\{\s*state,/);
});
