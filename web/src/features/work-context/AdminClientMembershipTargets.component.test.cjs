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
const {
  AdminClientMembershipTargets,
  ClientMembershipTargetDisclosure,
  pruneClientMembershipDisclosureState,
  toggleExpandedClient,
} = require("./AdminClientMembershipTargets.tsx");

const client = { id: "client-private-id", name: "A very long client name with a label that should wrap cleanly in narrow layouts" };

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(AdminClientMembershipTargets, {
    targets: { status: "ready", targets: [client] },
    renderMemberships: () => React.createElement("p", null, "Membership editor mounted"),
    ...props,
  }));
}

function findDisclosureButton(element) {
  if (!React.isValidElement(element)) return null;
  if (element.props && element.props["aria-controls"]) return element;
  const children = React.Children.toArray(element.props?.children);
  for (const child of children) {
    const match = findDisclosureButton(child);
    if (match) return match;
  }
  return null;
}

test("keeps loading, unavailable, error, and empty target states distinct", () => {
  const loading = render({ targets: { status: "loading" } });
  assert.match(loading, /Loading client targets/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-busy="true"/);

  const unavailable = render({ targets: { status: "unavailable", message: "Membership access is not available." } });
  assert.match(unavailable, /Client targets are unavailable/);
  assert.match(unavailable, /Membership access is not available\./);
  assert.doesNotMatch(unavailable, /client-private-id|Membership editor mounted/);

  const error = render({ targets: { status: "error", message: "The client list failed." } });
  assert.match(error, /Client targets could not load/);
  assert.match(error, /The client list failed\./);
  assert.match(error, /role="alert"/);

  const empty = render({ targets: { status: "ready", targets: [] } });
  assert.match(empty, /No client targets are available/);
  assert.match(empty, /with your current access/);
  assert.doesNotMatch(empty, /<ul|Membership editor mounted/);
});

test("renders closed client disclosures without mounting the membership renderer or exposing target IDs", () => {
  let calls = 0;
  const html = render({ renderMemberships: (selected) => {
    calls += 1;
    return React.createElement("p", null, selected.name);
  } });

  assert.match(html, /Client memberships/);
  assert.match(html, new RegExp(client.name));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+-membership-target-0"/);
  assert.match(html, /role="region" aria-labelledby="[^"]+-membership-target-0-trigger"/);
  assert.match(html, /hidden=""/);
  assert.doesNotMatch(html, /client-private-id|<select\b/);
  assert.equal(calls, 0);
});

test("first opening mounts the editor once and close/reopen preserves it", () => {
  let expanded = false;
  let visited = false;
  let membershipEditor = null;
  let isCurrent = null;
  const renderedClients = [];
  const renderRow = () => ClientMembershipTargetDisclosure({
    client,
    controlsId: "membership-panel-0",
    expanded,
    visited,
    membershipEditor,
    isClientTargetCurrent: () => expanded,
    onToggle: () => { expanded = !expanded; return true; },
    onFirstOpen: (editor) => {
      visited = true;
      membershipEditor = editor;
    },
    renderMemberships: (selected, isClientTargetCurrent) => {
      renderedClients.push(selected);
      isCurrent = isClientTargetCurrent;
      return React.createElement("input", { defaultValue: "Draft survives collapse", "aria-label": "Membership note" });
    },
  });

  const closedRow = renderRow();
  assert.equal(renderedClients.length, 0);
  findDisclosureButton(closedRow).props.onClick();
  assert.equal(expanded, true);

  const openRow = renderRow();
  const openHtml = renderToStaticMarkup(openRow);
  assert.match(openHtml, /aria-expanded="true"/);
  assert.match(openHtml, /id="membership-panel-0"/);
  assert.match(openHtml, /Draft survives collapse/);
  assert.equal(isCurrent(), true);
  assert.deepEqual(renderedClients, [client]);

  findDisclosureButton(openRow).props.onClick();
  assert.equal(expanded, false);
  const collapsedHtml = renderToStaticMarkup(renderRow());
  assert.match(collapsedHtml, /aria-expanded="false"/);
  assert.match(collapsedHtml, /hidden=""/);
  assert.match(collapsedHtml, /Draft survives collapse/);
  assert.equal(isCurrent(), false);
  assert.equal(renderedClients.length, 1);

  findDisclosureButton(renderRow()).props.onClick();
  assert.equal(expanded, true);
  assert.match(renderToStaticMarkup(renderRow()), /Draft survives collapse/);
  assert.equal(isCurrent(), true);
  assert.equal(renderedClients.length, 1);
});

test("expanded target tracking is isolated by client ID and does not mutate prior state", () => {
  const before = new Set(["client-a"]);
  const opened = toggleExpandedClient(before, "client-b");
  const closed = toggleExpandedClient(opened, "client-a");
  assert.deepEqual([...before], ["client-a"]);
  assert.deepEqual([...opened], ["client-a", "client-b"]);
  assert.deepEqual([...closed], ["client-b"]);
});

test("drops expanded and cached editor state when a target leaves the host projection", () => {
  const editorA = React.createElement("p", null, "private membership editor A");
  const editorB = React.createElement("p", null, "current membership editor B");
  const current = {
    expandedTargets: new Set(["client-a", "client-b"]),
    visitedTargets: new Set(["client-a", "client-b"]),
    membershipEditors: new Map([["client-a", editorA], ["client-b", editorB]]),
  };
  const next = pruneClientMembershipDisclosureState(current, new Set(["client-b"]));

  assert.notEqual(next, current);
  assert.deepEqual([...next.expandedTargets], ["client-b"]);
  assert.deepEqual([...next.visitedTargets], ["client-b"]);
  assert.deepEqual([...next.membershipEditors.keys()], ["client-b"]);
  assert.equal(next.membershipEditors.get("client-b"), editorB);
  assert.equal(pruneClientMembershipDisclosureState(next, new Set(["client-b"])), next);
});

test("does not create a membership editor after a stale disclosure event", () => {
  let calls = 0;
  const row = ClientMembershipTargetDisclosure({
    client,
    controlsId: "membership-target-stale",
    expanded: false,
    visited: false,
    membershipEditor: null,
    isClientTargetCurrent: () => false,
    onToggle: () => false,
    onFirstOpen: () => { throw new Error("stale targets cannot retain an editor"); },
    renderMemberships: () => { calls += 1; return null; },
  });

  findDisclosureButton(row).props.onClick();
  assert.equal(calls, 0);
});

test("responsive target rows preserve long labels, touch size, keyboard focus, and forced colors", () => {
  const css = fs.readFileSync(path.join(__dirname, "AdminClientMembershipTargets.module.css"), "utf8");
  assert.match(css, /container: admin-client-membership-targets \/ inline-size/);
  assert.match(css, /@container admin-client-membership-targets \(max-width: 36rem\)/);
  assert.match(css, /min-height: max\(44px, var\(--nova-control-touch-target\)\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /nova-motion-duration-fast/);
  assert.match(css, /\.chevron\[data-expanded="true"\]/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /:focus-visible/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
