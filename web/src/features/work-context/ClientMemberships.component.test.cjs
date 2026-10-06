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
const { buildClientMembershipInput, ClientMembershipsView } = require("./ClientMemberships.tsx");

const baseProps = {
  client: { id: "client-1", name: "Northstar" },
  canViewMemberships: true,
  canManageMemberships: true,
  read: { status: "idle", memberships: [], hasMore: false, nextCursor: null, loadingMore: false },
  peopleOptions: [{ id: "person-1", label: "Aman Verma" }],
  onLoadMemberships() {},
  onLoadMore() {},
  onAddMembership() {},
  onEndMembership() {},
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(ClientMembershipsView, { ...baseProps, ...overrides }));
}

test("renders an accessible searchable person control with a FormData-backed value", () => {
  const html = render();
  assert.match(html, /role="combobox"/);
  assert.match(html, /name="personId" value=""/);
  assert.match(html, /Search people/);
  assert.match(html, /Effective from/);
  assert.doesNotMatch(html, /<select\b/);
});

test("does not expose the custom picker when membership or people-list access is unavailable", () => {
  const denied = render({ canViewMemberships: false });
  const noPeopleChoices = render({ peopleOptions: null });
  assert.doesNotMatch(denied, /role="combobox"|Add client membership/);
  assert.match(noPeopleChoices, /authorized people list/);
  assert.doesNotMatch(noPeopleChoices, /role="combobox"|Add client membership/);
});

test("renders authorized departments as an optional searchable control with a named value", () => {
  const html = render({ departmentOptions: [{ id: "department-1", name: "Design" }] });
  assert.match(html, /Client department \(optional\)/);
  assert.match(html, /name="clientDepartmentId" value=""/);
  assert.match(html, /Search client departments/);
  assert.match(html, /Leave blank when this membership is not department-specific\./);
  assert.doesNotMatch(html, /<select\b/);
});

test("projects a selected authorized person and existing department/date fields into the create DTO", () => {
  const values = new FormData();
  values.set("personId", "person-1");
  values.set("membershipLabel", "  Delivery lead  ");
  values.set("effectiveOn", "2026-04-01");
  values.set("clientDepartmentId", "department-1");
  assert.deepEqual(buildClientMembershipInput(
    values,
    [{ id: "person-1", label: "Aman Verma" }],
    [{ id: "department-1", name: "Design" }],
  ), {
    status: "ready",
    input: {
      personId: "person-1",
      membershipLabel: "Delivery lead",
      effectiveOn: "2026-04-01",
      clientDepartmentId: "department-1",
    },
  });
});

test("keeps a blank optional department as null and rejects stale department IDs", () => {
  const values = new FormData();
  values.set("personId", "person-1");
  values.set("effectiveOn", "2026-04-01");
  values.set("clientDepartmentId", "");
  assert.deepEqual(buildClientMembershipInput(
    values,
    [{ id: "person-1", label: "Aman Verma" }],
    [{ id: "department-1", name: "Design" }],
  ), {
    status: "ready",
    input: {
      personId: "person-1",
      membershipLabel: null,
      effectiveOn: "2026-04-01",
      clientDepartmentId: null,
    },
  });

  values.set("clientDepartmentId", "department-removed");
  assert.deepEqual(buildClientMembershipInput(
    values,
    [{ id: "person-1", label: "Aman Verma" }],
    [{ id: "department-1", name: "Design" }],
  ), { status: "department-invalid" });
});

test("keeps the client heading and long names inside a narrow feature container", () => {
  const css = fs.readFileSync(path.join(__dirname, "ClientMemberships.module.css"), "utf8");
  assert.match(css, /\.header\s*>\s*div\s*\{\s*min-width:\s*0/);
  assert.match(css, /\.intro\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@container client-memberships \(max-width:\s*36rem\)/);
});

test("rejects stale selections and preserves required effective-date validation", () => {
  const values = new FormData();
  values.set("personId", "former-person");
  values.set("effectiveOn", "2026-04-01");
  assert.deepEqual(buildClientMembershipInput(values, [{ id: "person-1", label: "Aman Verma" }], undefined), { status: "person-required" });

  values.set("personId", "person-1");
  values.delete("effectiveOn");
  assert.deepEqual(buildClientMembershipInput(values, [{ id: "person-1", label: "Aman Verma" }], undefined), { status: "effective-date-required" });
});
