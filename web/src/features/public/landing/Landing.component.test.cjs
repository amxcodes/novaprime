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
const { Landing } = require("./Landing.tsx");

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(Landing, {
    onSetup() {},
    onSignIn() {},
    onAcceptInvitation() {},
    onDeploymentGuide() {},
    ...props,
  }));
}

test("landing presents four intent-led public routes in a single chooser list", () => {
  const html = render();
  assert.match(html, /<main[^>]*aria-labelledby="landing-title"/);
  assert.match(html, /<h1[^>]*>Start with a secure team foundation\.<\/h1>/);
  assert.match(html, /<h2[^>]*>Where are you in your NOVA journey\?<\/h2>/);
  for (const intent of [
    "I already have a NOVA account",
    "I have an invitation",
    "I’m setting up a new organisation",
    "I’m comparing deployment options",
  ]) {
    assert.ok(html.includes(intent), `missing intent: ${intent}`);
  }
  for (const action of ["Sign in", "Accept invitation", "Begin setup", "Read the deployment guide"]) {
    assert.ok(html.includes(action), `missing action: ${action}`);
  }
  assert.equal((html.match(/<button\b/g) || []).length, 4, "each intent has one clear action");
  assert.equal((html.match(/aria-labelledby="landing-path-intent-/g) || []).length, 4);
  assert.equal((html.match(/aria-describedby="landing-path-description-/g) || []).length, 4);
  for (const label of ["A clear foundation", "Organisation rules stay in PostgreSQL.", "Hosted and direct deployments share one workflow."]) {
    assert.match(html, new RegExp(label));
  }
});

test("all navigation is passed through host callbacks, with no route or API dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "Landing.tsx"), "utf8");
  const contracts = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8");
  for (const callback of ["onSetup", "onSignIn", "onAcceptInvitation", "onDeploymentGuide"]) {
    assert.match(contracts, new RegExp(`${callback}: \\(\\) => void`));
    assert.match(source, new RegExp(`on: "${callback}"`));
  }
  assert.match(source, /const actions = \{ onSetup, onSignIn, onAcceptInvitation, onDeploymentGuide \}/);
  assert.match(source, /onClick=\{actions\[path\.on\]\}/);
  assert.doesNotMatch(source, /onClick=\{onSetup\}|onClick=\{onSignIn\}/);
  assert.doesNotMatch(source, /fetch\s*\(|window\.location|<a\b|localStorage|sessionStorage/);
});

test("feature styling is tokenized, container-responsive, touch-friendly, and high-contrast aware", () => {
  const css = fs.readFileSync(path.join(__dirname, "Landing.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const buttonCss = fs.readFileSync(path.join(__dirname, "../../../design-system/primitives/Button.module.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];

  assert.match(css, /container: landing \/ inline-size/);
  assert.match(css, /@container landing \(max-width: 46rem\)/);
  assert.match(css, /@container landing \(max-width: 36rem\)/);
  assert.match(css, /\.pathList\s*\{[^}]*border-block/s);
  assert.match(css, /\.pathRow\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto/s);
  assert.match(css, /\.pathAction\s*\{[^}]*min-height: var\(--nova-control-touch-target\)/s);
  const compactRules = css.match(/@container landing \(max-width: 36rem\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(compactRules, /\.layout\s*\{[^}]*gap: var\(--nova-space-8\)/s);
  assert.doesNotMatch(compactRules, /\.root\s*\{/);
  assert.doesNotMatch(css, /\.pathGrid|\.pathCard|\.heroActions/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /h1\[tabindex="-1"\]:focus\s*\{\s*outline:\s*none/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(buttonCss, /@media \(any-pointer: coarse\)[\s\S]*?--nova-control-touch-target/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});
