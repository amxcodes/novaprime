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
const { RolePermissionsEditor } = require("./RolePermissionsEditor.tsx");
const { PermissionGrantMatrix } = require("./PermissionGrantMatrix.tsx");
const { RolePermissionsSection } = require("./RolePermissionsSection.tsx");

const role = {
  id: "role-1",
  key: "people_partner",
  name: "People Partner",
  revision: 3,
  isProtected: false,
  archivedAt: null,
  operationalPolicy: {
    workEnabled: true,
    canReceiveAssignments: false,
    attendanceRequired: false,
    wfhAllowed: true,
    canWorkWithoutAttendance: false,
    payrollApplicable: false,
    payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  },
  permissionGrants: [],
};

const permissions = [
  { key: "people.view", module: "People", description: "View people records.", allowedScopes: ["organisation", "office", "organisation_department"] },
  { key: "tasks.view", module: "Work", description: "View work records.", allowedScopes: ["assigned_work", "client", "client_workstream", "group"] },
];

function targetReads() {
  return {
    office: { status: "unavailable", options: [], message: "Office list requires organisation.settings.manage." },
    organisation_department: { status: "unavailable", options: [], message: "Department list requires organisation.settings.manage." },
    client: { status: "ready", options: [{ id: "client-1", name: "Client One" }] },
    client_workstream: { status: "ready", options: [{ id: "stream-1", name: "Stream One" }] },
    group: { status: "ready", options: [] },
  };
}

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(RolePermissionsEditor, {
    canView: true,
    canCreate: true,
    canEdit: false,
    readState: { status: "ready" },
    roles: [role],
    permissions,
    targetReads: targetReads(),
    formatError: () => undefined,
    onSearch: async () => [role],
    onCreate() {},
    onUpdate() {},
    ...overrides,
  }));
}

test("view plus create keeps the editor available when office and department selector reads are unavailable", () => {
  const html = render();

  assert.match(html, /Create custom role/);
  assert.match(html, /Create role/);
  assert.match(html, /Some scope targets are unavailable/);
  assert.match(html, /Office: Office list requires organisation\.settings\.manage/);
  assert.match(html, /Some scopes have no available targets/);
  assert.match(html, /Group: No group targets are available/);
  assert.doesNotMatch(html, /Group: group targets are unavailable/);
  assert.doesNotMatch(html, /role data unavailable/i);
});

test("ready-empty scope targets do not produce an unavailable warning", () => {
  const readyTargets = targetReads();
  for (const scope of ["office", "organisation_department", "client", "client_workstream"]) {
    readyTargets[scope] = { status: "ready", options: [{ id: `${scope}-1`, name: `${scope} target` }] };
  }
  const html = render({ targetReads: readyTargets });

  assert.match(html, /Some scopes have no available targets/);
  assert.match(html, /Group: No group targets are available/);
  assert.doesNotMatch(html, /Some scope targets are unavailable/);
  assert.doesNotMatch(html, /Group: group targets are unavailable/);
});

test("remote target search supersedes locally loaded scope target arrays", () => {
  const html = render({ onSearchTargets: async () => [{ id: "office-1", name: "Central" }] });
  const matrix = fs.readFileSync(path.join(__dirname, "PermissionGrantMatrix.tsx"), "utf8");

  assert.doesNotMatch(html, /Some scope targets are unavailable|Some scopes have no available targets/);
  assert.match(matrix, /searchMode: "remote"/);
  assert.match(matrix, /onSearchTargets\(targetScope, query\)/);
  assert.match(matrix, /targetOptions = onSearchTargets \? \[\]/);
});

test("the role section retains its heading and loading state and localizes lazy-feature errors", () => {
  const section = RolePermissionsSection({});
  const [header, boundaryElement] = React.Children.toArray(section.props.children);
  const suspenseElement = boundaryElement.props.children;
  const loadingFallback = suspenseElement.props.fallback;
  const boundaryType = boundaryElement.type;
  const failureState = boundaryType.getDerivedStateFromError(new Error("chunk failed"));
  const failureFallback = boundaryType.prototype.render.call({
    state: failureState,
    props: { children: null },
  });
  const failureHtml = renderToStaticMarkup(failureFallback);

  assert.match(renderToStaticMarkup(header), /Roles and permissions/);
  assert.equal(suspenseElement.type, React.Suspense);
  assert.match(renderToStaticMarkup(loadingFallback), /role="status"/);
  assert.match(renderToStaticMarkup(loadingFallback), /Loading role and permission controls/);
  assert.match(failureHtml, /role="alert"/);
  assert.match(failureHtml, /Role and permission controls could not load/);
});

test("scope controls honor modelled target availability and preserve saved selectors", () => {
  const source = fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.tsx"), "utf8");
  const matrix = fs.readFileSync(path.join(__dirname, "PermissionGrantMatrix.tsx"), "utf8");

  assert.match(matrix, /disabled: choice\.disabled/);
  assert.match(source, /onChange=\{\(nextId\) => \{/);
  assert.match(source, /placeholder="Choose a profile"/);
  assert.match(source, /options=\{\[\s*\.\.\.rolePresets\.map/);
  assert.match(source, /value=\{presetId \|\| null\}/);
  assert.match(matrix, /<Select\s+id=\{`\$\{id\}-scope`\}/);
  assert.match(matrix, /onChange=\{\(scope\) => onChange\(\{ scope, targetId: "" \}\)\}/);
  assert.match(matrix, /options=\{scopeChoices\.map\(\(choice\) => \(\{ value: choice\.value, label: choice\.label, disabled: choice\.disabled \}\)\)\}/);
  assert.match(matrix, /const searchableSelectProps: SearchableSelectProps/);
  assert.match(matrix, /<SearchableSelect \{\.\.\.searchableSelectProps\} \/>/);
  assert.match(matrix, /options: targetOptions/);
  assert.match(matrix, /value: grant\.targetId/);
  assert.match(matrix, /disabled: targetDisabled/);
  assert.match(matrix, /required: true/);
  assert.match(matrix, /onChange: targetChange/);
  assert.match(matrix, /Only scopes that need these targets are disabled/);
  assert.match(source, /onUpdateGrant=\{updateGrant\}/);
  assert.match(source, /onRemoveScope=\{removeScope\}/);
  assert.doesNotMatch(source, /<Select\s+id=\{`\$\{id\}-target`\}/);
});

test("the grant matrix renders as a controlled semantic disclosure and reports toggle changes", () => {
  const toggles = [];
  const matrix = PermissionGrantMatrix({
    id: "role-editor",
    modules: [{ name: "People", permissions: [permissions[0]] }],
    grants: { "people.view": [{ scope: "office", targetId: "office-1" }] },
    targetReads: {
      office: { status: "ready", options: [{ id: "office-1", name: "North office" }] },
      organisation_department: { status: "ready", options: [{ id: "department-1", name: "People" }] },
      client: { status: "ready", options: [{ id: "client-1", name: "Client One" }] },
      client_workstream: { status: "ready", options: [{ id: "stream-1", name: "Stream One" }] },
      group: { status: "ready", options: [{ id: "group-1", name: "Group One" }] },
    },
    canEdit: true,
    disabled: false,
    expandedModules: new Set(["People"]),
    onModuleToggle: (name, open) => toggles.push([name, open]),
    onPermissionChange() {},
    onAddScope() {},
    onUpdateGrant() {},
    onRemoveScope() {},
  });
  const sectionChildren = React.Children.toArray(matrix.props.children);
  const moduleList = sectionChildren.at(-1);
  const disclosure = React.Children.toArray(moduleList.props.children)[0];
  const html = renderToStaticMarkup(matrix);

  assert.equal(disclosure.type, "details");
  assert.equal(disclosure.props.open, true);
  disclosure.props.onToggle({ currentTarget: { open: false } });
  assert.deepEqual(toggles, [["People", false]]);
  assert.match(html, /<details[^>]*open=""/);
  assert.match(html, /North office|office-1/);
  assert.match(html, /Remove scope/);
  assert.match(html, /aria-labelledby="role-editor-permissions-title"/);
});

test("view-only actors see role records but no mutation controls", () => {
  const html = render({ canCreate: false, canEdit: false });

  assert.match(html, /People Partner/);
  assert.match(html, /Custom role/);
  assert.doesNotMatch(html, /Create custom role|Edit role|Save role|Create role/);
});

test("protected and archived roles never expose an edit action", () => {
  const html = render({
    canCreate: false,
    canEdit: true,
    roles: [
      { ...role, id: "protected", key: "super_admin", name: "Super Admin", isProtected: true },
      { ...role, id: "archived", key: "archived", name: "Archived role", archivedAt: "2026-01-01T00:00:00Z" },
    ],
  });

  assert.match(html, /Super Admin/);
  assert.match(html, /Archived role/);
  assert.doesNotMatch(html, /Edit role/);
});

test("payroll policy flags are described as future eligibility, not a payroll workflow", () => {
  const html = render();
  const source = fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.tsx"), "utf8");

  assert.match(html, /Payroll fields record future eligibility only; NOVA does not calculate or run payroll\./);
  assert.match(html, /Payroll eligibility/);
  assert.match(html, /Attendance in future payroll rules/);
  assert.match(html, /Overtime eligibility/);
  assert.match(html, /Enable payroll eligibility first\./);
  assert.match(source, /disabled=\{!canEditDraft \|\| submitting \|\| !prerequisiteEnabled\}/);
  assert.match(source, /updateRoleOperationalPolicy\(/);
  assert.doesNotMatch(html, /Include this role in payroll processing|Use attendance in payroll calculations/);
});

test("read failures stay explicit and errors receive focus", () => {
  const html = render({ readState: { status: "error", messages: ["Role catalogue could not load."] } });
  const source = fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.tsx"), "utf8");

  assert.match(html, /Role data unavailable/);
  assert.match(html, /Role catalogue could not load/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /aria-label="Role data could not load"/);
  assert.doesNotMatch(html, /Create custom role/);
  assert.match(source, /errorRef\.current\?\.focus\(\)/);
  assert.match(source, /role not saved/i);
});

test("the configured-role list is introduced by its visible heading", () => {
  const html = render();

  assert.match(html, /<h3[^>]*>Configured roles<\/h3>/);
  assert.match(html, /Search configured roles/);
  assert.match(html, /Search authorized roles by name, key, or status/);
  assert.match(html, /type="search"/);
  assert.match(html, /1 role available\./);
  assert.match(fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.tsx"), "utf8"), /props\.onSearch\(query\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.tsx"), "utf8"), /filterRoleRecords/);
  assert.doesNotMatch(html, /aria-label="Configured roles"/);
});

test("layout is responsive, tokenized, and provides touch-sized controls", () => {
  const css = fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.module.css"), "utf8");
  const matrixCss = fs.readFileSync(path.join(__dirname, "PermissionGrantMatrix.module.css"), "utf8");

  assert.match(css, /@container role-editor \(max-width: 39\.999rem\)/);
  assert.match(css, /@container role-editor \(min-width: 40rem\) and \(max-width: 63\.999rem\)/);
  assert.match(css, /@container role-editor \(min-width: 64rem\)/);
  assert.match(css, /var\(--nova-control-touch-target\)/);
  assert.match(css, /var\(--nova-color-surface\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.match(matrixCss, /@container role-editor \(max-width: 39\.999rem\)/);
  assert.match(matrixCss, /container: grant-list \/ inline-size/);
  assert.match(matrixCss, /@container grant-list \(min-width: 27rem\) and \(max-width: 35\.999rem\)/);
  assert.match(matrixCss, /@container grant-list \(min-width: 36rem\)/);
  assert.match(matrixCss, /var\(--nova-control-touch-target\)/);
  assert.match(matrixCss, /@media \(forced-colors: active\)/);
  assert.match(matrixCss, /border-color: CanvasText/);
  assert.doesNotMatch(matrixCss, /\.permissionModule\s*\{[^}]*overflow:\s*(?:clip|hidden)/s,
    "permission modules must not clip the shared outward focus ring");
  assert.match(matrixCss, /\.permissionModule:not\(\[open\]\)\s*>\s*\.moduleSummary\s*\{[^}]*border-end-start-radius:/s,
    "closed disclosures retain their rounded shape without clipping focus");
  assert.match(css, /\.editor :global\(:focus-visible\)\s*\{[^}]*outline:\s*2px solid var\(--nova-color-focus\)/s);
  assert.match(css, /\.roleList\s*\{[^}]*max-block-size:\s*min\(72dvh, 52rem\)[^}]*overflow-y:\s*auto/s,
    "long role catalogues scroll within the desktop list while the editor stays in view");
  assert.match(css, /@container role-editor \(min-width: 40rem\) and \(max-width: 47\.999rem\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    "compact tablets keep identity and policy fields in a readable single column");
  assert.match(css, /@container role-editor \(min-width: 48rem\) and \(max-width: 63\.999rem\)\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    "roomier tablets use a two-column form layout");
  assert.match(matrixCss, /\.grantList\s*\{[^}]*container:\s*grant-list \/ inline-size/s,
    "grant rows respond to their actual available width inside the permission editor");
  assert.match(matrixCss, /\.moduleSummary:focus-visible,\s*\.permissionToggle:focus-visible\s*\{[^}]*outline:/s,
    "disclosure and permission toggles retain a clear keyboard focus indicator");
  assert.doesNotMatch(matrixCss, /#[0-9a-f]{3,8}\b/i);
});

test("the role editor's wide layout responds through a child of its size container", () => {
  const css = fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.module.css"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "RolePermissionsEditor.tsx"), "utf8");

  assert.match(source, /<div className=\{styles\.editor\} data-has-draft=\{draft \? "true" : "false"\}>\s*<div className=\{styles\.layout\}>/);
  assert.match(css, /\.editor\s*\{[^}]*container:\s*role-editor\s*\/\s*inline-size/s);
  assert.match(css, /@container role-editor \(min-width: 64rem\)\s*\{\s*\.editor\[data-has-draft="true"\]\s+\.layout\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(css, /@container role-editor \(min-width: 64rem\)\s*\{\s*\.editor\s*\{/,
    "a size container cannot use its own query to change its column layout");
});
