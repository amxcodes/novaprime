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
const { AccountSecurity, AccountSecurityActionFeedback } = require("./AccountSecurity.tsx");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(AccountSecurity, {
    readState: { status: "ready", identity: { name: "Aman", email: "aman@example.test", emailVerified: false } },
    async onRequestVerification() {},
    async onChangePassword() {},
    async onLoadSessions() { return []; },
    async onRevokeSession() {},
    async onRevokeOtherSessions() {},
    async onReauthenticate() {},
    ...overrides,
  }));
}

test("loading and failure messages have accessible semantics", () => {
  const loading = render({ readState: { status: "loading" } });
  assert.match(loading, /Loading your account details/);
  assert.match(loading, /aria-busy="true"/);

  const failure = render({ readState: { status: "error", message: "Signed-in details are unavailable." } });
  assert.match(failure, /Account details could not be loaded/);
  assert.match(failure, /Signed-in details are unavailable/);
  assert.match(failure, /role="alert"/);
});

test("identity, verification, password fields, autocomplete, and minimum length are rendered", () => {
  const html = render();
  assert.match(html, /Aman/);
  assert.match(html, /aman@example\.test/);
  assert.match(html, /Verification pending/);
  assert.match(html, /data-tone="warning"><span>Verification pending<\/span><\/span>/);
  assert.match(html, /Request verification link/);
  assert.match(html, /<input[^>]*autoComplete="current-password"[^>]*name="currentPassword"/);
  assert.match(html, /<input[^>]*autoComplete="new-password"[^>]*minLength="8"[^>]*name="newPassword"/);
  assert.match(html, /<input[^>]*autoComplete="new-password"[^>]*minLength="8"[^>]*name="confirmPassword"/);
  assert.match(html, /Change password/);
  assert.match(html, /Active sessions/);
  assert.match(html, /Loading active sessions/);
});

test("verified identity hides the redundant verification action", () => {
  const html = render({ readState: { status: "ready", identity: { name: "Aman", email: "aman@example.test", emailVerified: true } } });
  assert.match(html, /Verified/);
  assert.match(html, /data-tone="success"><span>Verified<\/span><\/span>/);
  assert.doesNotMatch(html, /Request verification link/);
});

test("verification and password pending, success, and failure feedback render with live semantics", () => {
  const cases = [
    [{ status: "pending", label: "Changing password." }, /role="status"[^>]*aria-busy="true"[^>]*>.*Changing password/s],
    [{ status: "success", message: "Password changed." }, /data-kind="success"[^>]*role="status"/],
    [{ status: "error", message: "The current password is not correct." }, /role="alert"[^>]*>.*The current password is not correct/s],
  ];
  for (const [state, pattern] of cases) {
    const html = renderToStaticMarkup(React.createElement(AccountSecurityActionFeedback, { state }));
    assert.match(html, pattern);
  }
});

test("password mismatch and credential-local handling retain the draft on failure and clear it only after success", () => {
  const source = fs.readFileSync(path.join(__dirname, "AccountSecurity.tsx"), "utf8");
  assert.match(source, /newPassword !== confirmPassword/);
  assert.match(source, /The two new passwords do not match\./);
  assert.match(source, /passwordForm\.current\?\.reset\(\)/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  assert.match(source, /passwordInFlight\.current/);
  assert.match(source, /verificationInFlight\.current/);
});

test("password mismatch is attached to and focused on the confirmation field", () => {
  const source = fs.readFileSync(path.join(__dirname, "AccountSecurity.tsx"), "utf8");
  assert.match(source, /error=\{passwordMismatch \? passwordMismatchMessage : undefined\}/);
  assert.match(source, /ref=\{confirmPasswordInput\}/);
  assert.match(source, /requestAnimationFrame\(\(\) => confirmPasswordInput\.current\?\.focus\(\)\)/);
  assert.match(source, /onChange=\{\(\) => setPasswordMismatch\(false\)\}/);
});

test("styles use semantic tokens and adapt within the feature container", () => {
  const css = fs.readFileSync(path.join(__dirname, "AccountSecurity.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
  assert.match(css, /container: account-security \/ inline-size/);
  assert.match(css, /@container account-security \(min-width: 52rem\)/);
  assert.match(css, /@container account-security \(max-width: 40rem\)/);
  assert.match(css, /\.sessionList/);
  assert.match(css, /\.sessionItem[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?--nova-control-touch-target/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});

test("session actions expose only opaque IDs to the component and provide explicit confirmation", () => {
  const source = fs.readFileSync(path.join(__dirname, "AccountSecurity.tsx"), "utf8");
  assert.match(source, /onRevokeSession\(sessionId\)/);
  assert.match(source, /onRevokeOtherSessions\(\)/);
  assert.match(source, /Confirm sign out/);
  assert.match(source, /Sign in again/);
  assert.doesNotMatch(source, /tokenBySessionId|ipAddress|userAgent/);
});
