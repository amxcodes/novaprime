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
const { BillingPolicySection, TaskCatalogSection } = require("./WorkSetupSections.tsx");
const { mutationCanReload } = require("./WorkSetupShared.tsx");
const {
  definitionSearchStatus,
  workstreamSearchStatus,
} = require("./billing-search.ts");

const permissions = { view: true, propose: true, manage: true, review: true };
const entry = {
  id: "entry-1", title: "Prepare delivery brief", description: "Draft the client handoff.",
  priority: "high", revision: 7, createdByName: "Aman",
};
const proposal = {
  id: "proposal-1", action: "update", title: "Prepare delivery brief", description: null,
  priority: "normal", expectedRevision: 6, reason: "Align the recurring handoff.",
  status: "pending", proposerName: "Riya", canReview: true,
};
const catalogReady = { status: "ready", data: { entries: [entry], proposals: [proposal] } };
const noopAsync = async () => ({ status: "saved", policyClass: "billable", revision: 2 });

function renderCatalog(overrides = {}) {
  return renderToStaticMarkup(React.createElement(TaskCatalogSection, {
    permissions,
    read: catalogReady,
    onCreate: noopAsync,
    onUpdate: noopAsync,
    onArchive: noopAsync,
    onReview: noopAsync,
    ...overrides,
  }));
}

const workstream = {
  id: "workstream-1", clientName: "Northstar", name: "Product delivery",
  policyClass: "billable", policyRevision: 3,
};

function renderBilling(overrides = {}) {
  return renderToStaticMarkup(React.createElement(BillingPolicySection, {
    workstreams: { status: "ready", data: [workstream] },
    catalogAccess: "missing",
    onLoadRules: async () => ({ defaultClass: "billable", defaultRevision: 3, entries: [] }),
    onSearchWorkstreams: async () => [workstream],
    onSaveDefault: noopAsync,
    onSaveRule: noopAsync,
    ...overrides,
  }));
}

test("task-catalog section disappears without a catalogue capability, even if data was supplied", () => {
  const html = renderCatalog({ permissions: { view: false, propose: false, manage: false, review: false } });
  assert.equal(html, "");
  assert.doesNotMatch(html, /Prepare delivery brief|Align the recurring handoff/);
});

test("read-only catalogue access reveals approved summaries, not write or review controls", () => {
  const html = renderCatalog({ permissions: { view: true, propose: false, manage: false, review: false } });
  assert.match(html, /Approved definitions/);
  assert.match(html, /Prepare delivery brief/);
  assert.doesNotMatch(html, /Add a definition|Edit or archive|Suggestions and review|>Approve</);
});

test("proposal-only access never renders approved entries included in an overbroad host object", () => {
  const html = renderCatalog({ permissions: { view: false, propose: true, manage: false, review: false } });
  assert.match(html, /Suggest a definition/);
  assert.doesNotMatch(html, /Approved definitions|added by Aman/);
  assert.match(html, /Suggestions and review/);
});

test("catalog editors require reasons and revisions while keeping billing class out of catalog forms", () => {
  const html = renderCatalog();
  assert.match(html, /required=""[^>]*name="title"/);
  assert.match(html, /name="reason" required=""/);
  assert.match(html, /maxLength="2000"/);
  assert.match(html, /name="priority" value="high"/);
  assert.match(html, /revision 7/);
  assert.match(html, /Edit or archive/);
  assert.doesNotMatch(html, /name="billingClass"|name="billing_class"|<select/);
  assert.match(html, /Corrections remain linked work items, not billing adjustments/);
});

test("proposal decisions show the mandatory rejection note and preserve the server review boundary", () => {
  const html = renderCatalog();
  assert.match(html, /Review note \(required to reject\)/);
  assert.match(html, /Approve/);
  assert.match(html, /Reject/);
  assert.match(html, /proposed by Riya/);
});

test("proposal decisions stay hidden without server-derived row review eligibility", () => {
  const html = renderCatalog({ read: {
    status: "ready",
    data: { entries: [], proposals: [{ ...proposal, canReview: false }] },
  } });
  assert.match(html, /Review controls are unavailable for this suggestion/);
  assert.doesNotMatch(html, /Review note|>Approve<|>Reject</);
});

test("catalog and billing reads have independent loading, denied, and error presentations", () => {
  const catalogLoading = renderCatalog({ read: { status: "loading" } });
  assert.match(catalogLoading, /Loading approved task definitions/);
  assert.match(catalogLoading, /Add a definition/);

  const billingError = renderBilling({ workstreams: { status: "error", message: "Workstream read failed." } });
  assert.match(billingError, /Workstream read failed\./);
  assert.match(billingError, /Per-task rules need separate catalogue visibility/);

  const catalogDenied = renderCatalog({ read: { status: "denied", message: "Catalogue view grant required." } });
  assert.match(catalogDenied, /Catalogue view grant required\./);
});

test("billing-policy scope displays only projected manageable workstreams and makes future-only impact explicit", () => {
  const html = renderBilling();
  assert.match(html, /Northstar/);
  assert.match(html, /Product delivery/);
  assert.match(html, /Save default for future tasks/);
  assert.match(html, /never rewrites existing task records or timers/);
  assert.match(html, /task-catalog view or manage access/);
  assert.doesNotMatch(html, /<select|Broad employee directory|billingClass/);
});

test("search result announcements describe server-returned authorized matches", () => {
  assert.equal(workstreamSearchStatus("NORTH", 2), "2 matching client workstreams returned by NOVA.");
  assert.equal(workstreamSearchStatus("unmatched", 0), "No client workstreams match the current search.");
  assert.equal(definitionSearchStatus("delivery", 2), "2 matching predefined task definitions returned by NOVA.");
  assert.equal(definitionSearchStatus("unmatched", 0), "No predefined task definitions match the current search.");
});

test("both selector counts use a polite debounced live region rather than announcing keystrokes", () => {
  const source = fs.readFileSync(path.join(__dirname, "BillingPolicySection.tsx"), "utf8");
  assert.match(source, /const SEARCH_ANNOUNCEMENT_DELAY_MS = 300/);
  assert.match(source, /window\.setTimeout\(\(\) => setSettledQuery\(query\), SEARCH_ANNOUNCEMENT_DELAY_MS\)/);
  assert.equal((source.match(/role="status" aria-live="polite" aria-atomic="true">\{searchStatus\}<\/p>/g) || []).length, 2);
  assert.match(source, /onSearch\(query\)/);
  assert.match(source, /onLoadRules\(workstreamId, query\)/);
  assert.doesNotMatch(source, /filterWorkstreams|filterBillingDefinitions/);
  assert.match(source, /Search runs on NOVA/);
});

test("workstream read does not leak server rows when access is denied", () => {
  const html = renderBilling({ workstreams: { status: "denied", message: "No scoped billing grants." } });
  assert.match(html, /No scoped billing grants\./);
  assert.doesNotMatch(html, /Northstar|Product delivery/);
});

test("stale catalogue and access failures expose a reload action", () => {
  assert.equal(mutationCanReload({ code: "TASK_CATALOG_ENTRY_ARCHIVED" }), true);
  assert.equal(mutationCanReload({ code: "TASK_CATALOG_ENTRY_VERSION_CONFLICT" }), true);
  assert.equal(mutationCanReload({ code: "PERMISSION_DENIED" }), true);
  assert.equal(mutationCanReload({ code: "TASK_CATALOG_TITLE_EXISTS" }), false);
  assert.equal(mutationCanReload(new Error("network failed")), false);
});

test("feature styles use scoped semantic tokens and reflow workstream editors from one to two columns", () => {
  const css = fs.readFileSync(path.join(__dirname, "WorkSetupSections.module.css"), "utf8");
  assert.match(css, /container:\s*work-setup-section\s*\/\s*inline-size/);
  assert.match(css, /@container work-setup-section \(min-width:\s*68rem\)/);
  assert.match(css, /@container work-setup-section \(max-width:\s*38rem\)/);
  assert.match(css, /--nova-color-text-primary/);
  assert.match(css, /--nova-color-action-subtle/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(/i);
});

test("task-catalog disclosures use a tokenized chevron and preserve native details behavior", () => {
  const source = fs.readFileSync(path.join(__dirname, "TaskCatalogSection.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "WorkSetupSections.module.css"), "utf8");

  assert.match(source, /<details className=\{styles\.entryTools\}>\s*<summary>Edit or archive<\/summary>/);
  assert.match(css, /\.entryTools summary\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\)[^}]*list-style:\s*none/s);
  assert.match(css, /\.entryTools summary::marker\s*\{\s*content:\s*"";\s*\}/);
  assert.match(css, /\.entryTools summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.entryTools summary::after\s*\{[^}]*border-inline-end:\s*1\.5px solid currentColor[^}]*transition:\s*transform var\(--nova-motion-duration-fast\) var\(--nova-motion-ease-standard\)/s);
  assert.match(css, /\.entryTools\[open\] summary::after\s*\{[^}]*rotate\(225deg\)/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.entryTools summary::after\s*\{\s*border-color:\s*currentColor;/);
  assert.match(css, /\.entryTools summary:focus-visible\s*\{\s*outline-color:\s*Highlight;\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.entryTools summary::after\s*\{\s*transition:\s*none;/);
});

test("host mutation contract carries a required reason and expected revision for every editable resource", () => {
  const contract = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8");
  assert.match(contract, /interface CatalogEntryRevisionInput extends CatalogEntryInput\s*\{\s*expectedRevision: number/);
  assert.match(contract, /interface CatalogArchiveInput\s*\{\s*reason: string;\s*expectedRevision: number/);
  assert.match(contract, /interface BillingDefaultInput\s*\{\s*policyClass: BillingClass;\s*expectedRevision: number;\s*reason: string/);
  assert.match(contract, /interface BillingRuleInput\s*\{\s*policyClass: TaskRuleClass;\s*expectedRevision: number;\s*reason: string/);
});
