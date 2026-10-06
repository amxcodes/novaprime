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
const { WorkContextExplorer } = require("./WorkContextExplorer.tsx");
const { formatWorkContextSearchSummary, searchWorkContextProjection } = require("./search.ts");

const projection = {
  clients: [{ id: "client-1", name: "Northstar" }],
  clientWorkstreams: [
    { id: "client-stream-1", clientId: "client-1", clientName: "Northstar", name: "Delivery" },
    { id: "client-stream-2", clientId: "client-2", clientName: "Restricted client label", name: "Context-only stream" },
  ],
  organisationWorkstreams: [{ id: "org-stream-1", name: "Internal operations" }],
  workstreamTaskTargets: [],
  groups: [
    { id: "group-1", name: "Launch team", clientWorkstreamId: "client-stream-1", organisationWorkstreamId: null, canViewGroup: true, canCreateTask: false },
    { id: "group-2", name: "Task target group", clientWorkstreamId: null, organisationWorkstreamId: "org-stream-1", canViewGroup: false, canCreateTask: true },
    { id: "group-3", name: "Hidden group", clientWorkstreamId: null, organisationWorkstreamId: "org-stream-1", canViewGroup: false, canCreateTask: false },
    { id: "group-4", name: "Parent omitted group", clientWorkstreamId: "missing-stream", organisationWorkstreamId: null, canViewGroup: true, canCreateTask: false },
    { id: "group-5", name: "Client setup target", clientWorkstreamId: "client-stream-1", organisationWorkstreamId: null, canViewGroup: false, canCreateTask: true },
  ],
};

function render(readState, departmentCreation) {
  return renderToStaticMarkup(React.createElement(WorkContextExplorer, { readState, departmentCreation }));
}

test("renders distinct client and organisation hierarchies from the supplied projection", () => {
  const html = render({ status: "ready", projection });

  assert.match(html, /Client work/);
  assert.match(html, /Organisation work/);
  assert.match(html, /Northstar/);
  assert.match(html, /Delivery/);
  assert.match(html, /Launch team/);
  assert.match(html, /Internal operations/);
  assert.match(html, /Task target group/);
  assert.match(html, /Task target/);
  assert.match(html, /Eligible task creation targets/);
  assert.match(html, /Organisation workstream target/);
  assert.match(html, /Client context from visible workstream/);
  assert.match(html, /Groups without a visible workstream/);
  assert.match(html, /The parent client workstream is not included in this response/);
  assert.doesNotMatch(html, /Hidden group/);
  assert.ok(html.indexOf("Task target group") > html.indexOf("Eligible task creation targets"));
});

test("provides semantic headings and nested lists for accessible hierarchy", () => {
  const html = render({ status: "ready", projection });

  assert.match(html, /<h2[^>]*>Work context<\/h2>/);
  assert.match(html, /<h3[^>]*>Client work<\/h3>/);
  assert.match(html, /<h3[^>]*>Organisation work<\/h3>/);
  assert.match(html, /<ul[^>]*aria-label="Visible client contexts"/);
  assert.match(html, /<ul[^>]*aria-label="Workstreams for Northstar"/);
  assert.match(html, /<ul[^>]*aria-label="Groups in Delivery"/);
  assert.match(html, /role="search" aria-label="Work context"/);
  assert.match(html, /Search work context/);
  assert.match(html, /Clear search/);
  assert.match(html, /Search is local to this authorized response/);
  assert.match(html, /not a complete directory/);
});

test("distinguishes loading, denied, error, and empty states", () => {
  const loading = render({ status: "loading" });
  const denied = render({ status: "denied", message: "Access is limited to client members." });
  const error = render({ status: "error", message: "The request failed." });
  const empty = render({ status: "empty" });

  assert.match(loading, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  assert.match(loading, /Loading work context/);
  assert.match(denied, /Work context is unavailable/);
  assert.match(denied, /Access is limited to client members/);
  assert.match(error, /role="alert"/);
  assert.match(error, /The request failed/);
  assert.match(empty, /No visible work context/);
  assert.doesNotMatch(denied, /Northstar|Delivery/);
});

test("an empty successful projection stays an honest empty state", () => {
  const html = render({ status: "ready", projection: {
    clients: [], clientWorkstreams: [], organisationWorkstreams: [], workstreamTaskTargets: [], groups: [],
  } });

  assert.match(html, /No visible work context/);
  assert.doesNotMatch(html, /No organisation workstreams were included/);
});

test("create-only workstream targets render as non-navigable labels even without browse context", () => {
  const targetOnlyProjection = {
    clients: [],
    clientWorkstreams: [],
    organisationWorkstreams: [],
    workstreamTaskTargets: [
      { id: "client-hidden", kind: "client", name: "Allowed client target", clientName: "Northstar" },
      { id: "org-hidden", kind: "organisation", name: "Allowed organisation target" },
    ],
    groups: [],
  };
  const html = render({ status: "ready", projection: targetOnlyProjection });

  assert.match(html, /Allowed client target/);
  assert.match(html, /Northstar · Client workstream target/);
  assert.match(html, /Allowed organisation target/);
  assert.match(html, /Organisation workstream target/);
  assert.match(html, /Eligible task creation targets/);
  assert.doesNotMatch(html, /No visible work context/);
  assert.doesNotMatch(html, /<a\b|href=/);
});

test("local search finds an authorized create-only workstream by display label only", () => {
  const targetOnlyProjection = {
    clients: [],
    clientWorkstreams: [],
    organisationWorkstreams: [],
    workstreamTaskTargets: [
      { id: "client-hidden", kind: "client", name: "Allowed client target", clientName: "Northstar" },
      { id: "org-hidden", kind: "organisation", name: "Allowed organisation target" },
    ],
    groups: [],
  };
  const result = searchWorkContextProjection(targetOnlyProjection, "northstar");
  const html = render({ status: "ready", projection: result.projection });

  assert.equal(result.hasMatches, true);
  assert.equal(result.summary.taskTargets, 1);
  assert.deepEqual(result.projection.clients, []);
  assert.deepEqual(result.projection.clientWorkstreams, []);
  assert.deepEqual(result.projection.organisationWorkstreams, []);
  assert.deepEqual(result.projection.workstreamTaskTargets.map(({ id }) => id), ["client-hidden"]);
  assert.match(html, /Allowed client target/);
  assert.doesNotMatch(html, /Allowed organisation target|Visible client contexts/);

  const identifierSearch = searchWorkContextProjection(targetOnlyProjection, "client-hidden");
  assert.equal(identifierSearch.hasMatches, false);
});

test("searching a visible group preserves only its authorized parent context", () => {
  const result = searchWorkContextProjection(projection, "launch team");
  const html = render({ status: "ready", projection: result.projection });

  assert.equal(result.hasMatches, true);
  assert.deepEqual(result.projection.clients.map(({ id }) => id), ["client-1"]);
  assert.deepEqual(result.projection.clientWorkstreams.map(({ id }) => id), ["client-stream-1"]);
  assert.deepEqual(result.projection.groups.map(({ id }) => id), ["group-1"]);
  assert.match(html, /Northstar/);
  assert.match(html, /Delivery/);
  assert.match(html, /Launch team/);
  assert.doesNotMatch(html, /Internal operations|Task target group|Hidden group|Restricted client label/);
});

test("searching a context-only client label retains its visible workstream as context", () => {
  const result = searchWorkContextProjection(projection, "Restricted client label");
  const html = render({ status: "ready", projection: result.projection });

  assert.equal(result.hasMatches, true);
  assert.deepEqual(result.projection.clients, []);
  assert.deepEqual(result.projection.clientWorkstreams.map(({ id }) => id), ["client-stream-2"]);
  assert.match(html, /Restricted client label/);
  assert.match(html, /Context-only stream/);
  assert.match(html, /Client context from visible workstream/);
  assert.doesNotMatch(html, /Northstar|Delivery|Hidden group/);
});

test("eligible create-only labels stay separate and never expose the group as browseable", () => {
  const result = searchWorkContextProjection(projection, "Task target group");
  const html = render({ status: "ready", projection: result.projection });

  assert.equal(result.hasMatches, true);
  assert.deepEqual(result.projection.clients, []);
  assert.deepEqual(result.projection.clientWorkstreams, []);
  assert.deepEqual(result.projection.organisationWorkstreams, []);
  assert.deepEqual(result.projection.groups.map(({ id }) => id), ["group-2"]);
  assert.match(html, /Eligible task creation targets/);
  assert.match(html, /Organisation workstream target/);
  assert.match(html, /Task target group/);
  assert.doesNotMatch(html, /Internal operations|Hidden group|Groups in Internal operations/);
});

test("a directly matched visible parent includes eligible create-only targets in the separate list", () => {
  const result = searchWorkContextProjection(projection, "Delivery");
  const html = render({ status: "ready", projection: result.projection });

  assert.equal(result.hasMatches, true);
  assert.deepEqual(result.projection.clientWorkstreams.map(({ id }) => id), ["client-stream-1"]);
  assert.deepEqual(result.projection.groups.map(({ id }) => id), ["group-1", "group-5"]);
  assert.deepEqual(result.summary, { clientContexts: 1, workstreams: 1, visibleGroups: 1, taskTargets: 1 });
  assert.equal(formatWorkContextSearchSummary(result.summary), "Showing 1 client context, 1 workstream, 1 visible group, and 1 eligible task creation target in this response.");
  assert.match(html, /Northstar/);
  assert.match(html, /Delivery/);
  assert.match(html, /Launch team/);
  assert.match(html, /Eligible task creation targets/);
  assert.match(html, /Client setup target/);
  assert.match(html, /Client workstream target/);
  assert.doesNotMatch(html, /Hidden group|Restricted client label/);
});

test("search cannot find hidden labels or IDs and returns an honest local no-match result", () => {
  for (const query of ["Hidden group", "group-3", "client-1"]) {
    const result = searchWorkContextProjection(projection, query);
    assert.equal(result.hasMatches, false, `${query} must not match unrendered data`);
    assert.deepEqual(result.summary, { clientContexts: 0, workstreams: 0, visibleGroups: 0, taskTargets: 0 });
    assert.deepEqual(result.projection, {
      clients: [], clientWorkstreams: [], organisationWorkstreams: [], workstreamTaskTargets: [], groups: [],
    });
  }
});

test("shows department creation only on an explicitly visible client authorized by the host", () => {
  const authorized = render({ status: "ready", projection }, {
    authorizedClientIds: ["client-1", "client-2"],
    onCreate: async () => undefined,
  });
  const unauthorized = render({ status: "ready", projection }, {
    authorizedClientIds: ["client-2"],
    onCreate: async () => undefined,
  });

  assert.equal((authorized.match(/Create department/g) || []).length, 1);
  assert.match(authorized, /data-client-id="client-1"/);
  assert.doesNotMatch(authorized, /data-client-id="client-2"[^]*?Create department/);
  assert.doesNotMatch(unauthorized, /Create department/);
  assert.doesNotMatch(authorized, /Manage departments|Department directory|Existing departments/);
});

test("uses feature-owned semantic tokens and container-responsive layouts", () => {
  const css = fs.readFileSync(path.join(__dirname, "WorkContextExplorer.module.css"), "utf8");
  const component = fs.readFileSync(path.join(__dirname, "WorkContextExplorer.tsx"), "utf8");

  assert.match(css, /\.frame\s*\{[^}]*container:\s*work-context-explorer\s*\/\s*inline-size/s);
  assert.doesNotMatch(css, /\.explorer\s*\{[^}]*container:\s*work-context-explorer/s);
  assert.match(component, /<div className=\{styles\.frame\}>\s*<section className=\{styles\.explorer\}/);
  assert.match(css, /@container work-context-explorer \(max-width:\s*58rem\)/);
  assert.match(css, /@container work-context-explorer \(max-width:\s*38rem\)/);
  assert.match(css, /@container work-context-explorer \(max-width:\s*38rem\)\s*\{[^}]*\.explorer\s*\{[^}]*padding:\s*var\(--nova-space-3\)/s);
  assert.match(css, /\.searchForm \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.searchScope \{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css, /\.searchResultSummary \{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css, /\.searchScope,\s*\.searchResultSummary \{[^}]*grid-column:\s*auto/s);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /var\(--nova-color-[a-z-]+\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/i);
});

test("the component consumes a host projection and owns no API command surface", () => {
  const source = fs.readFileSync(path.join(__dirname, "WorkContextExplorer.tsx"), "utf8");
  const searchSource = fs.readFileSync(path.join(__dirname, "search.ts"), "utf8");
  const departmentAction = fs.readFileSync(path.join(__dirname, "ClientDepartmentCreate.tsx"), "utf8");
  const departmentStyles = fs.readFileSync(path.join(__dirname, "ClientDepartmentCreate.module.css"), "utf8");

  assert.match(source, /function WorkContextExplorer\(\{ readState, departmentCreation \}: WorkContextExplorerProps\)/);
  assert.doesNotMatch(source, /fetch\(|\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/clients\/|\bonUpdate|\bonDelete/);
  assert.doesNotMatch(searchSource, /fetch\(|\bfetch\s*\(|\/api\//);
  assert.match(source, /searchWorkContextProjection\(readState\.projection, search\)/);
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /setTimeout\(\(\) => \{\s*setAnnouncedSearch\(/);
  assert.match(source, /\}, 250\)/);
  assert.match(source, /announcedSearch\?\.query === search\.trim\(\)/);
  assert.match(source, /Search is local to this authorized response/);
  assert.match(source, /does not request or page through other records or change your access/);
  assert.match(source, /No matches in this authorized response/);
  assert.match(source, /setSearch\(""\)/);
  assert.match(source, /!isWorkstreamContextOnly/);
  assert.match(source, /departmentCreation\?\.authorizedClientIds\.includes\(client\.id\)/);
  assert.match(departmentAction, /maxLength=\{180\}/);
  assert.match(departmentAction, /label="Department name"/);
  assert.match(departmentAction, /aria-expanded=\{expanded\}/);
  assert.doesNotMatch(departmentAction, /fetch\(|\bfetch\s*\(|\/api\/clients\//);
  assert.match(departmentStyles, /var\(--nova-color-border\)/);
  assert.match(departmentStyles, /@container client-department-create \(max-width: 24rem\)/);
  assert.match(departmentStyles, /@media \(forced-colors: active\)/);
});

test("client department form adapts to its available panel width, not viewport width", () => {
  const css = fs.readFileSync(path.join(__dirname, "ClientDepartmentCreate.module.css"), "utf8");
  assert.match(css, /container:\s*client-department-create\s*\/\s*inline-size/);
  assert.match(css, /@container client-department-create \(max-width:\s*24rem\)/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*24rem\)/);
});
