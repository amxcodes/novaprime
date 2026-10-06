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
const { TaskComposer, focusFirstInvalidControl } = require("./TaskComposer.tsx");
const { applyCatalogSelection, parseTaskComposerDraft, isValidTaskDueDate } = require("./task-composer-model.ts");

const target = {
  key: "client:stream-1",
  id: "stream-1",
  kind: "client",
  clientName: "Acme",
  name: "Delivery",
  billingPolicyClass: "billable",
};
const targetOptions = { status: "ready", items: [target] };
const catalogEntry = {
  id: "catalog-1",
  title: "Prepare report",
  description: "Prepare the monthly report.",
  priority: "high",
  revision: 4,
};
const authorized = {
  canCreate: true,
  targets: targetOptions,
  groups: { status: "ready", items: [{ id: "group-1", name: "North team", workstreamId: "stream-1", workstreamKind: "client" }] },
  catalog: { status: "ready", items: [catalogEntry] },
  corrections: { status: "ready", items: [{ id: "task-1", title: "Approved deliverable", workstreamId: "stream-1", workstreamKind: "client" }] },
  departments: { status: "ready", items: [{ id: "department-1", name: "Operations" }] },
  selfAssignment: { status: "eligible", defaultChecked: true },
  onSubmit: async () => {},
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(TaskComposer, { ...authorized, ...overrides }));
}

function draft(overrides = {}) {
  return {
    targetKey: target.key,
    title: "Ship report",
    catalogEntryId: "",
    groupId: "",
    departmentId: "",
    description: "",
    priority: "normal",
    dueDate: "",
    correctionOfTaskId: "",
    correctionReason: "",
    assignToSelf: true,
    ...overrides,
  };
}

test("hides the composer when the host has not projected create eligibility", () => {
  const html = render({ canCreate: false });
  assert.equal(html, "");
  assert.doesNotMatch(html, /Create task|Acme|Delivery/);
});

test("keeps unavailable reads, failed reads, and a genuinely empty target list distinct", () => {
  const notRequested = render({ targets: { status: "not-requested" } });
  assert.match(notRequested, /choices are not available/);
  assert.doesNotMatch(notRequested, /<form/);

  const denied = render({ targets: { status: "denied", message: "A target read permission is required." } });
  assert.match(denied, /Workstream choices are unavailable/);
  assert.match(denied, /target read permission is required/);

  const failed = render({ targets: { status: "error", message: "The service is offline." } });
  assert.match(failed, /Workstream choices could not load/);
  assert.match(failed, /The service is offline/);

  const empty = render({ targets: { status: "ready", items: [] } });
  assert.match(empty, /No workstream is available/);
  assert.doesNotMatch(empty, /<form/);
});

test("renders host-projected target choices with accessible searchable comboboxes", () => {
  const html = render();
  assert.match(html, /role="combobox"/);
  assert.match(html, /Workstream/);
  assert.match(html, /Create task/);
  assert.match(html, /Add this to my assignments now/);
  assert.match(html, /checked=""/);
  assert.match(html, /NOVA applies billing automatically/);
  assert.match(html, /Task title/);
  assert.match(html, /Due date \(optional\)/);
  assert.match(html, /Description \(optional\)/);
  assert.match(html, /aria-describedby/);
  assert.match(html, /role="radiogroup"/);
  assert.equal((html.match(/type="radio"/g) || []).length, 4);
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /name="taskCatalogEntryId"/);
});

test("keeps remote business search available when the initial Admin pages are empty", () => {
  const html = render({
    targets: { status: "ready", items: [] },
    catalog: { status: "ready", items: [] },
    corrections: { status: "ready", items: [] },
    departments: { status: "ready", items: [] },
    onSearchTargets: async () => [target],
    onSearchCatalog: async () => [catalogEntry],
    onSearchCorrections: async () => [{ id: "task-2", title: "Approved task", workstreamId: "stream-1", workstreamKind: "client" }],
    onSearchDepartments: async () => [{ id: "department-2", name: "Research" }],
  });
  assert.match(html, /Create task/);
  assert.match(html, /Workstream/);
  assert.match(html, /Task definition \(optional\)/);
  assert.match(html, /Completed task to correct \(optional\)/);
  assert.match(html, /Department \(optional\)/);
  assert.equal((html.match(/role="combobox"/g) || []).length, 4);
  assert.doesNotMatch(html, /No workstream is available for task creation/);
  assert.doesNotMatch(html, /No approved task definitions are available/);
});

test("moves validation focus from an invalid group wrapper to its first enabled control", () => {
  const calls = [];
  const radio = {
    matches: (selector) => selector.includes("input:not(:disabled)"),
    focus: () => calls.push("radio focused"),
  };
  const invalidGroup = {
    matches: () => false,
    querySelector: (selector) => {
      assert.match(selector, /input:not\(:disabled\)/);
      return radio;
    },
  };
  const form = {
    querySelector: (selector) => {
      assert.equal(selector, "[aria-invalid='true']");
      return invalidGroup;
    },
  };

  focusFirstInvalidControl(form);
  assert.deepEqual(calls, ["radio focused"]);
});

test("keeps compact form layout single-column and makes responsive radio focus visible", () => {
  const css = fs.readFileSync(`${__dirname}/TaskComposer.module.css`, "utf8");
  const pairedFields = css.match(/\.pairedFields\s*\{([^}]*)\}/s)?.[1] || "";
  const tabletLayout = css.match(/@container task-composer \(min-width: 42rem\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(css, /container-name:\s*task-composer/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(pairedFields, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(tabletLayout, /\.pairedFields\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(tabletLayout, /\.priorityChoices\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.priorityChoice\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\)/s);
  assert.match(css, /\.priorityChoice:focus-within\s*\{\s*outline:\s*2px solid var\(--nova-color-focus\)/);
  assert.match(css, /\.priorityChoice:focus-within\s*\{\s*outline-color:\s*Highlight/s);
});

test("task search and form controls follow shared field and button state tokens", () => {
  const css = fs.readFileSync(`${__dirname}/TaskComposer.module.css`, "utf8");
  const fieldCss = fs.readFileSync(`${__dirname}/../../../design-system/primitives/Field.module.css`, "utf8");
  const buttonCss = fs.readFileSync(`${__dirname}/../../../design-system/primitives/Button.module.css`, "utf8");
  const component = fs.readFileSync(`${__dirname}/TaskComposer.tsx`, "utf8");
  const forcedColors = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(css, /\.form\s*\{[^}]*gap:\s*var\(--nova-space-4\)/s);
  assert.match(css, /\.textarea:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--nova-color-text-muted\)/s);
  assert.match(css, /\.textarea:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/s);
  assert.match(css, /\.textarea\[aria-invalid="true"\]:focus-visible\s*\{[^}]*var\(--nova-color-danger\)/s);
  assert.match(css, /\.textarea:disabled\s*\{[^}]*var\(--nova-control-background-disabled\)/s);
  assert.match(fieldCss, /\.control:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/s);
  assert.match(buttonCss, /\.button\[data-variant="primary"\]:hover:not\(:disabled\)\s*\{[^}]*var\(--nova-color-action-hover\)/s);
  assert.match(css, /\.priorityChoice:not\(\[data-disabled="true"\]\):hover\s*\{[^}]*background:\s*var\(--nova-color-surface-subtle\)/s);
  assert.match(css, /\.priorityChoice\[data-disabled="true"\]\s*\{[^}]*cursor:\s*not-allowed/s);
  assert.match(component, /data-disabled=\{submitting \|\| undefined\}/);
  assert.match(forcedColors, /\.textarea[^}]*color:\s*FieldText;[^}]*background:\s*Field/s);
  assert.match(forcedColors, /\.priorityChoice\[data-disabled="true"\][^}]*color:\s*GrayText/);
  assert.match(css, /\.priorityLegend\s*\{\s*margin:\s*0;/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/i);
});

test("keeps task form copy and single-field rows within their available container width", () => {
  const css = fs.readFileSync(`${__dirname}/TaskComposer.module.css`, "utf8");

  assert.match(css, /\.root\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /\.root\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.header h2\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.header p\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.pairedFields\s*>\s*\.field:only-child\s*\{\s*grid-column:\s*1 \/ -1;\s*\}/);
  assert.match(css, /\.pairedFields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /@container task-composer \(min-width:\s*42rem\)/);
  assert.match(css, /@media \(any-pointer:\s*coarse\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/i);
});

test("shows optional read failures without collapsing a usable create form", () => {
  const html = render({
    catalog: { status: "error", message: "Definitions failed." },
    corrections: { status: "denied", message: "Completed task access is not available." },
    departments: { status: "error", message: "Departments failed." },
    selfAssignment: { status: "unavailable", message: "Assignment eligibility could not be confirmed." },
  });
  assert.match(html, /Definitions failed/);
  assert.match(html, /Completed task access is not available/);
  assert.match(html, /Departments failed/);
  assert.match(html, /Assignment eligibility could not be confirmed/);
  assert.match(html, /Create task/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("does not offer self-assignment when the authorized eligibility projection denies it", () => {
  const html = render({ selfAssignment: { status: "ineligible", message: "This role cannot receive assignments." } });
  assert.match(html, /This role cannot receive assignments/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("validates a free-form title and keeps correction links tied to the selected workstream", () => {
  const missingTitle = parseTaskComposerDraft(draft({ title: " " }), authorized);
  assert.equal(missingTitle.input, undefined);
  assert.equal(missingTitle.errors.title, "Enter a task title or choose a task definition.");

  const wrongGroup = parseTaskComposerDraft(draft({ groupId: "another-group" }), authorized);
  assert.equal(wrongGroup.errors.groupId, "Choose a group available in the selected workstream.");

  const wrongCorrection = parseTaskComposerDraft(draft({ correctionOfTaskId: "hidden-task", correctionReason: "Fix it" }), authorized);
  assert.equal(wrongCorrection.errors.correctionOfTaskId, "Choose completed work in the selected workstream.");
});

test("requires a bounded correction reason and builds the server payload from authorized choices", () => {
  const missingReason = parseTaskComposerDraft(draft({ correctionOfTaskId: "task-1" }), authorized);
  assert.equal(missingReason.errors.correctionReason, "Describe what needs correcting.");

  const result = parseTaskComposerDraft(draft({
    catalogEntryId: "catalog-1",
    title: "",
    priority: "high",
    groupId: "group-1",
    departmentId: "department-1",
    dueDate: "2026-10-31",
    correctionOfTaskId: "task-1",
    correctionReason: "Repair the approved report.",
  }), authorized);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.input, {
    title: "",
    clientWorkstreamId: "stream-1",
    workGroupId: "group-1",
    organisationDepartmentId: "department-1",
    taskCatalogEntryId: "catalog-1",
    taskCatalogRevision: 4,
    description: null,
    priority: "high",
    dueDate: "2026-10-31",
    correctionOfTaskId: "task-1",
    correctionReason: "Repair the approved report.",
    assignToSelf: true,
  });
  assert.equal(Object.hasOwn(result.input, "billingClass"), false);
});

test("uses a server-projected group-scoped target without exposing other groups", () => {
  const groupTarget = { ...target, key: "client:stream-1:group:group-1", requiredGroupId: "group-1", groupName: "North team" };
  const result = parseTaskComposerDraft(draft({ targetKey: groupTarget.key }), {
    targets: { status: "ready", items: [groupTarget] },
    selfAssignment: authorized.selfAssignment,
  });
  assert.equal(result.errors.targetKey, undefined);
  assert.equal(result.input.workGroupId, "group-1");
});

test("drops a stale self-assignment draft if host-projected eligibility is lost", () => {
  const result = parseTaskComposerDraft(draft({ assignToSelf: true }), {
    targets: targetOptions,
    selfAssignment: { status: "ineligible" },
  });
  assert.equal(result.input.assignToSelf, false);
});

test("catalog switching resets untouched old defaults but preserves edited values", () => {
  const base = draft({
    catalogEntryId: catalogEntry.id,
    title: catalogEntry.title,
    description: catalogEntry.description,
    priority: catalogEntry.priority,
  });
  assert.deepEqual(applyCatalogSelection(base, "", [catalogEntry]), {
    ...base,
    catalogEntryId: "",
    title: "",
    description: "",
    priority: "normal",
  });
  const edited = applyCatalogSelection({ ...base, title: "My edited title" }, "", [catalogEntry]);
  assert.equal(edited.title, "My edited title");
});

test("validates calendar dates without relying on the browser's locale or current time", () => {
  assert.equal(isValidTaskDueDate("2024-02-29"), true);
  assert.equal(isValidTaskDueDate("2025-02-29"), false);
  assert.equal(isValidTaskDueDate("2026-13-01"), false);
  assert.equal(isValidTaskDueDate("0000-01-01"), false);
});
