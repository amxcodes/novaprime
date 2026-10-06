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
const { PasswordReset } = require("./PasswordReset.tsx");

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(PasswordReset, {
    onResetPassword() {},
    linkAvailable: true,
    onRequestNewLink() {},
    onBackToSignIn() {},
    ...props,
  }));
}

test("valid reset page provides labeled new-password fields and host-owned actions", () => {
  const html = render();
  assert.match(html, /<h1[^>]*>Choose a new password\.<\/h1>/);
  assert.match(html, /label for="[^"]+-password"[\s\S]*?New password/);
  assert.match(html, /name="newPassword"/);
  assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /minLength="8"/);
  assert.match(html, /Confirm new password/);
  assert.match(html, /name="confirmPassword"/);
  assert.match(html, /Save new password/);
  assert.match(html, /Back to sign in/);
  assert.doesNotMatch(html, /<select\b/);
});

test("missing, rejected, and expired links omit every credential field and offer safe routes", () => {
  const html = render({ linkAvailable: false });
  assert.match(html, /This reset link is no longer valid\./);
  assert.match(html, /Request a new password reset link and use the latest email\./);
  assert.match(html, /Request a new link/);
  assert.match(html, /Back to sign in/);
  assert.doesNotMatch(html, /name="newPassword"|name="confirmPassword"|Save new password/);
  const source = fs.readFileSync(path.join(__dirname, "PasswordReset.tsx"), "utf8");
  assert.match(source, /if \(error instanceof PasswordResetLinkError\)[\s\S]*?setLinkExpired\(true\)/);
  assert.match(source, /const canReset = linkAvailable && !linkExpired/);
});

test("password checks reject short and mismatched values before host submission", () => {
  const source = fs.readFileSync(path.join(__dirname, "PasswordReset.tsx"), "utf8");
  assert.match(source, /password\.length < 8/);
  assert.match(source, /password !== confirmation/);
  assert.match(source, /if \(nextPasswordError \|\| nextConfirmationError\)[\s\S]*?return/);
  assert.match(source, /await onResetPassword\(password\)/);
  assert.match(source, /if \(submitLock\.current \|\| !canReset\) return/);
});

test("error copy is generic and credentials never enter URL, storage, or logs", () => {
  const source = fs.readFileSync(path.join(__dirname, "PasswordReset.tsx"), "utf8");
  assert.match(source, /Your password could not be reset\. Check your connection and try again\./);
  assert.doesNotMatch(source, /fetch\s*\(|localStorage|sessionStorage|URLSearchParams|window\.location|console\.(log|info|warn|error)/);
  assert.match(source, /setPassword\(""\)/);
  assert.match(source, /setConfirmation\(""\)/);
});

test("responsive styling uses defined semantic tokens and high contrast support", () => {
  const css = fs.readFileSync(path.join(__dirname, "PasswordReset.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
  assert.match(css, /width: min\(100%, 28rem\)/);
  assert.match(css, /container: password-reset \/ inline-size/);
  assert.match(css, /@container password-reset \(max-width: 23rem\)/);
  assert.match(css, /@media \(any-pointer: coarse\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /\.title:focus-visible\s*\{[^}]*outline\s*:\s*none/s);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});

test("expired-link heading keeps a visible focus indicator after focus moves to it", () => {
  const component = fs.readFileSync(path.join(__dirname, "PasswordReset.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "PasswordReset.module.css"), "utf8");
  const resetStyles = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/reset.css"), "utf8");

  assert.match(component, /if \(linkExpired\) headingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(component, /<h1[^>]*ref=\{headingRef\}[^>]*tabIndex=\{-1\}/);
  assert.doesNotMatch(css, /\.title:focus-visible\s*\{[^}]*outline\s*:\s*none/s);
  assert.match(resetStyles, /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--nova-color-focus\)/s);
});

test("reset route leaves viewport sizing to the public frame and stays centered by its shell", () => {
  const css = fs.readFileSync(path.join(__dirname, "PasswordReset.module.css"), "utf8");
  const root = css.match(/\.root\s*\{([^}]*)\}/)?.[1] || "";
  assert.ok(root, "reset root style exists");
  assert.doesNotMatch(root, /min-height|padding-block/);
  assert.match(root, /align-content:\s*center/);
});
