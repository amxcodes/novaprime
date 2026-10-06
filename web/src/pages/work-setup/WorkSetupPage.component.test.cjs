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
const { WorkSetupPage } = require("./WorkSetupPage.tsx");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(WorkSetupPage, {
    showTaskCatalog: true,
    showBillingPolicy: true,
    ...overrides,
  }));
}

test("owns one route heading, feedback target, loading state, and ordered feature slots", () => {
  const markup = render();
  assert.equal((markup.match(/<h1\b/g) || []).length, 1);
  assert.match(markup, /<h1[^>]*><span id="work-setup-page-title">Work setup<\/span><\/h1>/);
  assert.match(markup, /id="feedback"/);
  assert.match(markup, /id="work-setup-content"/);
  assert.match(markup, /data-work-setup-loading[^>]*role="status">Loading work setup\./);
  const catalog = markup.indexOf('data-work-setup-slot="catalog"');
  const billing = markup.indexOf('data-work-setup-slot="billing-policy"');
  assert.ok(catalog >= 0 && billing > catalog);
  assert.doesNotMatch(markup, /<main\b|class="panel/);
});

test("omits feature targets that the host did not authorize for this route", () => {
  const catalogOnly = render({ showBillingPolicy: false });
  assert.match(catalogOnly, /data-work-setup-slot="catalog"/);
  assert.doesNotMatch(catalogOnly, /data-work-setup-slot="billing-policy"|work-setup-billing-root/);

  const billingOnly = render({ showTaskCatalog: false });
  assert.match(billingOnly, /data-work-setup-slot="billing-policy"/);
  assert.doesNotMatch(billingOnly, /data-work-setup-slot="catalog"|work-setup-catalog-root/);
});

test("keeps an explicit pending grant state when no feature slots are authorized", () => {
  const markup = render({ showTaskCatalog: false, showBillingPolicy: false });
  assert.match(markup, /data-work-setup-no-features[^>]*role="status">Checking the work-setup features available to your current role\./);
  assert.doesNotMatch(markup, /data-work-setup-slot=/);
});

test("uses a one-column inline-size composition and semantic tokens without another content frame", () => {
  const source = fs.readFileSync(path.join(__dirname, "WorkSetupPage.module.css"), "utf8");
  const pageRule = source.match(/\.page\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(pageRule, /container:\s*work-setup-page \/ inline-size/);
  assert.match(pageRule, /width:\s*100%;/);
  assert.match(pageRule, /min-width:\s*0;/);
  assert.doesNotMatch(pageRule, /max-width:|padding-inline:|margin-inline:/);
  assert.match(source, /\.sections\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(source, /@container work-setup-page \(max-width: 60rem\)/);
  assert.match(source, /@container work-setup-page \(max-width: 40rem\)/);
  assert.match(source, /var\(--nova-space-7\)/);
  assert.match(source, /var\(--nova-color-border\)/);
  assert.doesNotMatch(source, /overflow-x:\s*(?:auto|scroll)|#[0-9a-f]{3,8}\b/i);
});

test("keeps read planning in the host and feature mutations behind the action adapter", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const adapter = fs.readFileSync(path.join(__dirname, "../../../app/work-setup-route.js"), "utf8");
  const actionAdapter = fs.readFileSync(path.join(__dirname, "../../../app/work-setup-actions-route.ts"), "utf8");
  const start = host.indexOf("async function renderWorkSetup(lifetime)");
  const end = host.indexOf("\nfunction navigatePersonHistory(", start);
  const route = host.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(host, /import \{ createWorkSetupRoute \} from "\.\/app\/work-setup-route\.js"/);
  assert.match(host, /loadCatalogSection: \(\) => import\("\.\/src\/features\/work-setup\/TaskCatalogSection\.tsx"\)/);
  assert.match(host, /loadBillingPolicySection: \(\) => import\("\.\/src\/features\/work-setup\/BillingPolicySection\.tsx"\)/);
  assert.match(route, /const readPlan = planWorkSetupReads\(state\.actorGrants\)/);
  assert.match(route, /readPlan\.taskCatalog\s*\?\s*readOrError\(pageApi\("\/api\/task-catalog", lifetime\)/);
  assert.match(route, /readPlan\.billingPolicy\s*\?\s*readOrError\(pageApi\("\/api\/work-context", lifetime\)/);
  assert.match(route, /if \(!isCurrentPageRequest\(lifetime\)\) return/);
  assert.match(route, /if \(!readPlan\.hasAny\)[\s\S]*?no work-setup features available/);
  assert.match(route, /serverCatalogPermissions\.view === true && workSetupPermission\(actorGrants, "tasks\.catalog\.view"\)/);
  assert.match(route, /await workSetupRoute\(\{/);
  assert.match(adapter, /mountReactIsland\(catalogRoot, catalogModule\.TaskCatalogSection/);
  assert.match(adapter, /mountReactIsland\(billingRoot, billingModule\.BillingPolicySection/);
  assert.match(route, /"\/api\/task-catalog"/);
  assert.match(host, /can: \(permissionKey, target\) => workSetupPermission\(state\.actorGrants, permissionKey, target\)/);
  assert.match(actionAdapter, /can\("workstreams\.billing_policy\.manage", target\)/);
  assert.match(host, /runCommand: runWorkSetupCommand/);
  assert.match(actionAdapter, /requestOptions\(method, input\)/);
  assert.match(actionAdapter, /requestOptions\("PATCH", input\)/);
  assert.match(actionAdapter, /runCommand\(/);
  const contracts = fs.readFileSync(path.join(__dirname, "../../features/work-setup/contracts.ts"), "utf8");
  assert.match(contracts, /interface CatalogEntryRevisionInput extends CatalogEntryInput\s*\{\s*expectedRevision: number/);
  assert.match(contracts, /interface BillingDefaultInput\s*\{\s*policyClass: BillingClass;\s*expectedRevision: number;\s*reason: string/);
});
