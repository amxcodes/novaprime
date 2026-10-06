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
const { OwnerTransfer } = require("./OwnerTransfer.tsx");
const componentPath = path.join(__dirname, "OwnerTransfer.tsx");
const cssPath = path.join(__dirname, "OwnerTransfer.module.css");

function render(props = {}) {
  const privateTargetId = "person-secret-id";
  return renderToStaticMarkup(React.createElement(OwnerTransfer, {
    canTransfer: true,
    read: { status: "ready", choices: [{ label: "Aman Verma", transfer() { void privateTargetId; } }] },
    onRetry() {},
    ...props,
  }));
}

test("owner transfer presentation is absent without the host's Super Admin capability", () => {
  const html = render({ canTransfer: false });
  assert.equal(html, "");
});

test("warning, target, confirmation, and submit are labeled and explicit", () => {
  const html = render();
  assert.match(html, /Ownership transfer/);
  assert.match(html, /Your active sessions will be revoked/);
  assert.match(html, /New owner/);
  assert.match(html, /Only active or notice people are listed\./);
  assert.match(html, /Confirmation/);
  assert.match(html, /Type TRANSFER SUPER ADMIN exactly\./);
  assert.match(html, /Transfer ownership/);
  assert.doesNotMatch(html, /person-secret-id/);
});

test("loading, unavailable, read failure, and empty choices remain distinct", () => {
  const loading = render({ read: { status: "loading" } });
  assert.match(loading, /Loading eligible people/);
  assert.doesNotMatch(loading, /<form/);

  const unavailable = render({ read: { status: "unavailable", message: "People access needs a refresh." } });
  assert.match(unavailable, /Eligible people are unavailable/);
  assert.match(unavailable, /People access needs a refresh\./);
  assert.match(unavailable, /Retry people list/);

  const failed = render({ read: { status: "error", message: "People could not load." } });
  assert.match(failed, /Eligible people could not load/);
  assert.match(failed, /People could not load\./);
  assert.match(failed, /Retry people list/);

  const empty = render({ read: { status: "ready", choices: [] } });
  assert.match(empty, /No eligible person is available/);
  assert.doesNotMatch(empty, /<form/);
});

test("submission guards, exact confirmation, pending, and recovery stay feature-owned", () => {
  const source = fs.readFileSync(componentPath, "utf8");
  assert.match(source, /const confirmationPhrase = "TRANSFER SUPER ADMIN"/);
  assert.match(source, /submitLock\.current \|\| props\.read\.status !== "ready"/);
  assert.match(source, /confirmation === confirmationPhrase/);
  assert.match(source, /await target!\.transfer\(\)/);
  assert.match(source, /setSubmitting\(true\)/);
  assert.match(source, /setSuccess\(true\)/);
  assert.match(source, /setError\(messageFrom\(transferError/);
  assert.match(source, /NOVA did not confirm the transfer/);
  assert.match(source, /getElementById\(`\$\{id\}-target`\)\?\.focus\(\)/);
  assert.match(source, /feedbackRef\.current\?\.focus\(\)/);
});

test("feature CSS uses semantic tokens and container-aware mobile layout", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  assert.match(css, /container: owner-transfer \/ inline-size/);
  assert.match(css, /@container owner-transfer \(min-width: 42rem\)/);
  assert.match(css, /--nova-control-touch-target/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
