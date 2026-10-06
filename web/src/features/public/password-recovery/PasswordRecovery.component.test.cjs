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
const { PasswordRecovery } = require("./PasswordRecovery.tsx");

function render() {
  return renderToStaticMarkup(React.createElement(PasswordRecovery, {
    onRequestReset() {},
    onBackToSignIn() {},
  }));
}

test("recovery screen retains public route copy, email semantics, and host navigation", () => {
  const html = render();
  const source = fs.readFileSync(path.join(__dirname, "PasswordRecovery.tsx"), "utf8");
  assert.match(html, /Password recovery/);
  assert.match(html, /Reset your password\./);
  assert.match(html, /If it is registered, NOVA will send a secure reset link\./);
  assert.match(html, /label for="[^"]+-email"[\s\S]*?Email address/);
  assert.match(html, /type="email"[^>]*autoComplete="email"/);
  assert.match(html, /name="email"/);
  assert.match(html, /required=""/);
  assert.match(html, /Send reset link/);
  assert.match(html, /Back to sign in/);
  assert.match(source, /onRequestReset\(email\)/);
  assert.match(source, /onBackToSignIn/);
  assert.doesNotMatch(source, /fetch\s*\(|window\.location|history\.|localStorage|sessionStorage|console\.(log|info|warn|error)/);
});

test("successful request uses account-neutral confirmation and failures stay generic", () => {
  const source = fs.readFileSync(path.join(__dirname, "PasswordRecovery.tsx"), "utf8");
  const html = render();
  assert.match(html, /Send reset link/);
  assert.match(source, /If that email is registered, NOVA has requested password recovery/);
  assert.match(source, /Password recovery could not be requested/);
  assert.doesNotMatch(source, /USER_NOT_FOUND|EMAIL_NOT_FOUND|emailExists|accountExists/);
  assert.match(source, /catch \{[\s\S]*?setFormError/);
});

test("pending state locks duplicate requests and validation errors are associated to the email field", () => {
  const source = fs.readFileSync(path.join(__dirname, "PasswordRecovery.tsx"), "utf8");
  assert.match(source, /if \(submitLock\.current\) return/);
  assert.match(source, /submitLock\.current = true/);
  assert.match(source, /submitLock\.current = false/);
  assert.match(source, /disabled=\{submitting\}/);
  assert.match(source, /loadingLabel="Sending reset link"/);
  assert.match(source, /error=\{emailError\s*\|\|\s*undefined\}/);
  assert.match(source, /emailRef\.current\?\.focus\(\)/);
  assert.match(source, /Enter a valid email address\./);
});

test("responsive styles use semantic tokens, touch targets, and narrow-container layout", () => {
  const css = fs.readFileSync(path.join(__dirname, "PasswordRecovery.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
  assert.match(css, /width: min\(100%, 28rem\)/);
  assert.match(css, /container: password-recovery \/ inline-size/);
  assert.match(css, /@container password-recovery \(max-width: 23rem\)/);
  assert.match(css, /@media \(any-pointer: coarse\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.title:focus-visible\s*\{\s*outline:\s*none;/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});
