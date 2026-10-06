const assert = require("node:assert/strict");
const fs = require("node:fs");
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
const { OrganizationStructure } = require("./OrganizationStructure.tsx");
const { OrganizationStructureLoadBoundary } = require("./OrganizationStructureSection.tsx");
const { OrganizationStructureFallback } = require("./OrganizationStructureFallback.tsx");

const office = {
  id: "office-1",
  name: "Bengaluru HQ",
  location: "Bengaluru, India",
  timezone: "Asia/Kolkata",
  latitude: 12.9716,
  longitude: 77.5946,
  geofenceRadiusMeters: 150,
};
const department = { id: "department-1", name: "Engineering" };

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(OrganizationStructure, {
    canView: true,
    canManageOrganization: true,
    canManageOfficeGeofence: true,
    offices: { status: "ready", items: [office] },
    departments: { status: "ready", items: [department] },
    onCreateOffice() {},
    onCreateDepartment() {},
    ...overrides,
  }));
}

test("hides organization data and actions when host feature visibility is false", () => {
  const html = render({ canView: false });
  assert.equal(html, "");
  assert.doesNotMatch(html, /Bengaluru HQ|Engineering|Create office/);
});

test("shows authorized office and department summaries with geofence state", () => {
  const html = render();
  assert.match(html, /Bengaluru HQ/);
  assert.match(html, /Bengaluru, India/);
  assert.match(html, /Asia\/Kolkata/);
  assert.match(html, /Geofence · 150 m/);
  assert.match(html, /Engineering/);
  assert.match(html, /<strong>1<\/strong> office/);
  assert.match(html, /<strong>1<\/strong> department/);
});

test("office and department heading relationships stay unique across instances", () => {
  const instanceProps = {
    canView: true,
    canManageOrganization: false,
    canManageOfficeGeofence: false,
    offices: { status: "ready", items: [office] },
    departments: { status: "ready", items: [department] },
    onCreateOffice() {},
    onCreateDepartment() {},
  };
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(OrganizationStructure, instanceProps),
    React.createElement(OrganizationStructure, instanceProps),
  ));
  const officeIds = [...html.matchAll(/id="([^"]+-offices-title)"/g)].map((match) => match[1]);
  const departmentIds = [...html.matchAll(/id="([^"]+-departments-title)"/g)].map((match) => match[1]);

  assert.equal(officeIds.length, 2);
  assert.equal(new Set(officeIds).size, 2);
  assert.equal(departmentIds.length, 2);
  assert.equal(new Set(departmentIds).size, 2);
  for (const id of [...officeIds, ...departmentIds]) assert.match(html, new RegExp(`aria-labelledby="${id}"`));
});

test("office creation requires both projected grants while department creation follows organization settings", () => {
  const html = render({ canManageOfficeGeofence: false });
  assert.doesNotMatch(html, /<h4[^>]*>Create office<\/h4>/);
  assert.match(html, /office geofence management access/);
  assert.match(html, /<h4[^>]*>Create department<\/h4>/);
  assert.match(html, /name="name"/);
  assert.match(html, /maxLength="180"/);
});

test("hides create actions without organization settings management", () => {
  const html = render({ canManageOrganization: false });
  assert.doesNotMatch(html, /Create office|Create department|office geofence management access/);
  assert.doesNotMatch(html, /Organisation structure actions|Add to your organisation/);
  assert.match(html, /Bengaluru HQ/);
});

test("keeps office read and department read failures independent from each other", () => {
  const html = render({
    offices: { status: "error", items: [], message: "Office read failed." },
  });
  assert.match(html, /Offices could not load/);
  assert.match(html, /Office read failed\./);
  assert.match(html, /Engineering/);
});

test("uses server-aligned office field constraints and narrow-screen responsive layout", () => {
  const html = render();
  assert.match(html, /name="location"/);
  assert.match(html, /maxLength="320"/);
  assert.match(html, /name="timezone"/);
  assert.match(html, /maxLength="120"/);
  assert.match(html, /min="-90" max="90" step="any"/);
  assert.match(html, /min="-180" max="180" step="any"/);
  assert.match(html, /min="10" max="100000" step="1"/);
  const css = fs.readFileSync(require("node:path").join(__dirname, "OrganizationStructure.module.css"), "utf8");
  assert.match(css, /container:\s*organization-structure\s*\/\s*inline-size/);
  assert.match(css, /@container organization-structure \(min-width:\s*72rem\)/);
  assert.match(css, /@container organization-structure \(max-width:\s*38rem\)/);
  assert.match(css, /\.fields\s*\{\s*display:\s*grid;\s*min-width:\s*0;\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("distinguishes loading, unavailable, failed, and empty reads", () => {
  const loading = render({ offices: { status: "loading", items: [] } });
  const unavailable = render({ offices: { status: "unavailable", items: [], message: "Read grant required." } });
  const error = render({ offices: { status: "error", items: [], message: "Network failed." } });
  const empty = render({ offices: { status: "ready", items: [] } });
  assert.match(loading, /Loading offices/);
  assert.match(unavailable, /Read grant required\./);
  assert.match(error, /Network failed\./);
  assert.match(empty, /No offices yet/);
});

test("keeps lazy or synchronous feature failures in an accessible local boundary", () => {
  const boundary = new OrganizationStructureLoadBoundary({
    children: React.createElement("p", null, "Authorized organization data"),
  });
  boundary.state = OrganizationStructureLoadBoundary.getDerivedStateFromError(new Error("render failure"));
  const html = renderToStaticMarkup(boundary.render());

  assert.match(html, /role="alert"/);
  assert.match(html, /Organization structure could not load/);
  assert.match(html, /Reload Admin to try again/);
  assert.equal((html.match(/<h2\b/g) || []).length, 1);
  assert.match(html, /aria-labelledby=/);

  const loading = renderToStaticMarkup(React.createElement(OrganizationStructureFallback, { state: "loading" }));
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading offices and departments/);
  assert.equal((loading.match(/<h2\b/g) || []).length, 1);
});
