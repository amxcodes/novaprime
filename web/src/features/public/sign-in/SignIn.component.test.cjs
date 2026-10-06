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
const { SignIn } = require("./SignIn.tsx");

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(SignIn, {
    onSignIn() {},
    onForgotPassword() {},
    onBack() {},
    ...props,
  }));
}

test("sign-in fields retain their accessible names, required state, and browser autofill contract", () => {
  const html = render();
  assert.doesNotMatch(html, /<main/);
  assert.match(html, /<h1[^>]*>Welcome back\.<\/h1>/);
  assert.match(html, /<label[^>]*for="[^"]+-email"[^>]*>[\s\S]*?Email address/);
  assert.match(html, /type="email"[^>]*autoComplete="email"/);
  assert.match(html, /name="email"/);
  assert.match(html, /<label[^>]*for="[^"]+-password"[^>]*>[\s\S]*?Password/);
  assert.match(html, /type="password"[^>]*autoComplete="current-password"/);
  assert.match(html, /name="password"/);
  assert.match(html, /required=""/);
  assert.match(html, /Sign in/);
  assert.match(html, /Forgot password\?/);
  assert.match(html, /Back/);
});

test("component keeps sign-in, recovery, and back navigation behind host callbacks", () => {
  const source = fs.readFileSync(path.join(__dirname, "SignIn.tsx"), "utf8");
  assert.match(source, /await onSignIn\(\{ email, password \}\)/);
  assert.match(source, /onForgotPassword/);
  assert.match(source, /onBack/);
  assert.doesNotMatch(source, /fetch\s*\(|localStorage|sessionStorage|console\.(log|info|warn|error)/);
  assert.doesNotMatch(source, /JSON\.stringify|data-password|data-credential/);
});

test("existing host feedback remains visible as text within the sign-in feature", () => {
  const html = render({ notice: { kind: "success", message: "Your password was reset." } });
  assert.match(html, /Your password was reset\./);
  assert.match(html, /data-kind="success"/);
});

test("submit locks duplicate requests, disables fields, and gives failures an announced neutral response", () => {
  const source = fs.readFileSync(path.join(__dirname, "SignIn.tsx"), "utf8");
  const html = render();
  assert.match(source, /if \(inFlight\.current\) return/);
  assert.match(source, /inFlight\.current = true/);
  assert.match(source, /inFlight\.current = false/);
  assert.match(source, /loadingLabel="Signing in"/);
  assert.match(source, /disabled=\{submitting\}/);
  assert.match(source, /disabled=\{submitting\} onClick=\{onForgotPassword\}/);
  assert.match(source, /disabled=\{submitting\} onClick=\{onBack\}/);
  assert.match(source, /We couldn't sign you in\. Check your details and try again\./);
  assert.doesNotMatch(source, /feedbackRef|feedback\.current\?\.focus/);
});

test("validation errors are wired back to their input controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "SignIn.tsx"), "utf8");
  assert.match(source, /error=\{emailError\s*\|\|\s*undefined\}/);
  assert.match(source, /error=\{passwordError\s*\|\|\s*undefined\}/);
  assert.match(source, /emailRef\.current\?\.focus\(\)/);
  assert.match(source, /passwordRef\.current\?\.focus\(\)/);
  assert.match(source, /Enter a valid email address\./);
});

test("responsive styles use semantic tokens, touch targets, and focus visibility", () => {
  const css = fs.readFileSync(path.join(__dirname, "SignIn.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const resetStyles = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/reset.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
  assert.match(css, /width: min\(100%, 28rem\)/);
  assert.match(css, /container: sign-in \/ inline-size/);
  assert.match(css, /@container sign-in \(max-width: 23rem\)/);
  assert.match(css, /@media \(any-pointer: coarse\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.title:focus-visible\s*\{\s*outline: none;/);
  assert.match(resetStyles, /:focus-visible/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});
