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
const { AdminPage } = require("./AdminPage.tsx");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(AdminPage, {
    state: { status: "ready" },
    sections: [],
    ...overrides,
  }));
}

test("owns one page heading and keeps each supplied feature in host order without adding feature headings", () => {
  const markup = render({
    summary: "Northwind · 12 people",
    sections: [
      { id: "organization-structure", content: React.createElement("section", { "aria-labelledby": "org-title" }, React.createElement("h2", { id: "org-title" }, "Offices and departments")) },
      { id: "people", content: React.createElement("section", { "aria-labelledby": "people-title" }, React.createElement("h2", { id: "people-title" }, "People and onboarding")) },
      { id: "audit", content: React.createElement("section", { "aria-labelledby": "audit-title" }, React.createElement("h2", { id: "audit-title" }, "Recent audit activity")) },
    ],
  });

  assert.equal((markup.match(/<h1\b/g) || []).length, 1);
  assert.match(markup, /<h1 id="admin-page-title" tabindex="-1">Admin console<\/h1>/);
  assert.match(markup, /Northwind · 12 people/);
  const positions = ["organization-structure", "people", "audit"].map((id) => markup.indexOf(`data-admin-section-slot="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(markup, /Offices and departments/);
  assert.match(markup, /People and onboarding/);
  assert.match(markup, /Recent audit activity/);
  assert.doesNotMatch(markup, /<h2[^>]*>Admin console<\/h2>/);
});

test("loading and route failure are announced without rendering feature slots", () => {
  const loading = render({ state: { status: "loading" }, sections: [
    { id: "people", content: React.createElement("section", null, "People data") },
  ] });
  assert.match(loading, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  assert.match(loading, /Loading organisation data/);
  assert.doesNotMatch(loading, /data-admin-section-slot|People data/);

  const error = render({ state: { status: "error", message: "Try again after reconnecting." }, sections: [] });
  assert.match(error, /role="alert"/);
  assert.match(error, /Try again after reconnecting\./);
  assert.doesNotMatch(error, /No Admin features are available/);
});

test("does not create section scaffolding when the host supplies no authorized features", () => {
  const markup = render({ sections: [] });
  assert.match(markup, /No Admin features are available for your current permissions\./);
  assert.doesNotMatch(markup, /data-admin-section-slot=/);
});

test("keeps partial grant-read warnings without suppressing independently authorized sections", () => {
  const markup = render({
    routeWarning: "Permission data is unavailable. Write controls are hidden.",
    sections: [{ id: "audit", content: React.createElement("section", null, "Recent audit rows") }],
  });

  assert.match(markup, /Current access could not be confirmed/);
  assert.match(markup, /Permission data is unavailable/);
  assert.match(markup, /data-admin-section-slot="audit"/);
  assert.match(markup, /Recent audit rows/);
});

test("does not describe unavailable permission data as confirmed absence of features", () => {
  const markup = render({
    routeWarning: "Permission data is unavailable. Write controls are hidden.",
    sections: [],
  });

  assert.match(markup, /Current access could not be confirmed/);
  assert.match(markup, /Permission data is unavailable/);
  assert.doesNotMatch(markup, /No Admin features are available for your current permissions/);
  assert.doesNotMatch(markup, /data-admin-section-slot=/);
});

test("keeps the host feedback target and uses a single-scroll responsive page composition", () => {
  const markup = render();
  const css = fs.readFileSync(path.join(__dirname, "AdminPage.module.css"), "utf8");
  assert.match(markup, /<p id="feedback" class="notice" role="status" hidden=""><\/p>/);
  assert.match(markup, /<section[^>]*aria-labelledby="admin-page-title"/);
  assert.doesNotMatch(markup, /<main\b|overflow-x|overflow-y/);
  assert.match(css, /container: admin-page \/ inline-size/);
  assert.match(css, /@container admin-page \(max-width: 60rem\)/);
  assert.match(css, /@container admin-page \(max-width: 40rem\)/);
  assert.match(css, /\.sections\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /\.sections\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.doesNotMatch(css, /grid-template-columns:\s*repeat\(|overflow-(?:x|y):\s*(?:auto|scroll)/);
});

test("provides a visible programmatic focus target for completed Admin commands", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "..", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "AdminPage.module.css"), "utf8");
  assert.match(appSource, /state\.pendingAdminCommandFocus = true;[\s\S]*?render\(\);/);
  assert.match(appSource, /props\.state\?\.status !== "loading" && state\.pendingAdminCommandFocus/);
  assert.match(appSource, /target\.querySelector\("#admin-page-title"\)\?\.focus\(\{ preventScroll: true \}\)/);
  const reviewCommandStart = appSource.indexOf("async function runAdminRequestReviewCommand(");
  const reviewCommand = appSource.slice(reviewCommandStart, appSource.indexOf("function organizationListRead(", reviewCommandStart));
  assert.match(reviewCommand, /state\.pendingAdminCommandFocus = true;\s*render\(\);/);
  assert.match(css, /\.header h1:focus\s*\{[^}]*outline:\s*3px solid var\(--nova-color-focus\)/s);
});

test("keeps section authorization outside the feature-owned presentation", () => {
  const source = fs.readFileSync(path.join(__dirname, "AdminPage.tsx"), "utf8");
  assert.match(source, /already authorized/i);
  assert.doesNotMatch(source, /canShowAdminFeature|hasPermissionGrant|planAdminReads|fetch\(/);
});
