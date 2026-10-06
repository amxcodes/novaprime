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
const { InvitePage } = require("./InvitePage.tsx");

function render(canInvite) {
  return renderToStaticMarkup(React.createElement(InvitePage, { canInvite, onSubmit() {} }));
}

test("authorized invitation route has one page heading and a server-handled, labeled form", () => {
  const html = render(true);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<h1[^>]*><span id="invite-page-title">Invite a person<\/span><\/h1>/);
  assert.match(html, /id="feedback" class="notice [^"]+" role="status" hidden=""/);
  assert.match(html, /<form id="invite-form"/);
  assert.match(html, /name="displayName"/);
  assert.match(html, /autoComplete="name"/);
  assert.match(html, /required=""/);
  assert.match(html, /name="email"/);
  assert.match(html, /type="email"/);
  assert.match(html, /autoComplete="email"/);
  assert.match(html, /Send invitation/);
  assert.match(html, /one-time link/);
  assert.doesNotMatch(html, /people-content|People directory/);
});

test("invitation form is absent when the host does not provide invite capability", () => {
  const html = render(false);
  assert.match(html, /Invitation unavailable/);
  assert.match(html, /Your role does not include permission to invite people\./);
  assert.doesNotMatch(html, /<form\b|name="displayName"|name="email"/);
});

test("invitation page stays tokenized, narrow, and touch-friendly on compact screens", () => {
  const css = fs.readFileSync(path.join(__dirname, "InvitePage.module.css"), "utf8");
  const page = css.match(/\.page\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(page, /container:\s*invite-page\s*\/\s*inline-size/);
  assert.match(page, /width:\s*100%;/);
  assert.match(page, /min-width:\s*0;/);
  assert.doesNotMatch(page, /padding-inline:|margin-inline:/);
  assert.match(css, /@container invite-page \(max-width: 60rem\)/);
  assert.match(css, /@container invite-page \(max-width: 40rem\)/);
  assert.match(css, /\.actions,[\s\S]*?\.actions > \*\s*\{[^}]*width:\s*100%/);
  assert.match(css, /var\(--nova-color-border\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
});

test("Invite route delegates permission, request, and submission lifecycle to its existing host", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const start = host.indexOf("async function renderInvite(lifetime)");
  const end = host.indexOf("\nasync function renderNotifications(", start);
  const invite = host.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(invite, /canShowInviteNavigation\(state\.actorGrants\)/);
  assert.match(invite, /mountReactIsland\(root, inviteUi\.InvitePage/);
  assert.match(invite, /onSubmit: \(event\) => \{ void submitInvite\(event\); \}/);
  const submitStart = host.indexOf("function submitInvite(event)");
  const submitEnd = host.indexOf("\nfunction reflectInvitationDelivery(", submitStart);
  const submit = host.slice(submitStart, submitEnd);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.match(submit, /api\("\/api\/people\/invitations", requestOptions\("POST", values\)\)/);
  assert.match(submit, /await api\([\s\S]*?\);\s*if \(!isCurrentCommand\(context\)\) return;\s*form\.reset\(\)/);
  assert.match(host, /if \(view === "invite"\) return renderInvite\(lifetime\)/);
});
