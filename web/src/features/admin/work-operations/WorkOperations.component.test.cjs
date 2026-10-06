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
const { WorkOperations } = require("./WorkOperations.tsx");
const { projectReadResult, projectWorkOperations } = require("./projection.ts");

const task = {
  id: "task-1",
  title: "Prepare the client delivery brief",
  description: "Summarize the decisions.",
  status: "in_progress",
  priority: "high",
  dueDate: "2026-10-12",
  dueDateRevision: 2,
  canEditDueDate: true,
  canAssign: true,
  canCancel: true,
  billingClass: "billable",
  billingPolicySource: "client_workstream",
  billingPolicyRevision: 3,
  taskDefinition: { entryId: "entry-1", revision: 4 },
  isCorrection: true,
  correctionReason: "Correct the missing handoff detail.",
  correctionOf: { taskId: "task-original", title: "Original handoff" },
  client: { id: "client-1", name: "Northstar" },
  workstream: { id: "workstream-1", name: "Delivery", kind: "client" },
  group: { id: "group-1", name: "Platform" },
  assignments: [{
    id: "assignment-1",
    personId: "person-1",
    personName: "Aman Verma",
    reviewerPersonId: "reviewer-1",
    reviewerName: "Nia Review",
    reviewRequired: true,
    reviewBlockedReason: "No eligible reviewer",
    resolutionSource: null,
    status: "in_progress",
    canReassign: true,
  }],
};
const allowed = (permission) => ["tasks.edit", "tasks.assign", "tasks.reassign"].includes(permission);

function projected(overrides = {}) {
  return projectWorkOperations({
    taskRead: { status: "ready", items: [task] },
    hasTaskPermission: (permission) => allowed(permission),
    ...overrides,
  });
}

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WorkOperations, {
    ...projected(),
    loadAssignmentOptions() { throw new Error("lazy options should not load during render"); },
    onAssign() {},
    onReassign() {},
    onCancel() {},
    onUpdateDueDate() {},
    ...props,
  }));
}

test("projects a safe task summary and intersects server action flags with current grants", () => {
  const result = projected({ hasTaskPermission: (permission) => permission !== "tasks.assign" });
  assert.equal(result.taskRead.status, "ready");
  assert.equal(result.taskRead.items[0].billingConfirmation, "NOVA automatically classified this task as Billable · client workstream default · policy r3");
  assert.equal(result.taskRead.items[0].definitionProvenance, "selected definition · revision 4");
  assert.equal(result.taskRead.items[0].canEditDueDate, true);
  assert.equal(result.taskRead.items[0].canCancel, true);
  assert.equal(result.taskRead.items[0].canAssign, false);
  assert.equal(result.taskRead.items[0].assignments[0].canReassign, true);
  assert.equal(result.taskRead.items[0].assignments[0].reviewerPersonId, "reviewer-1");
});

test("keeps task read failures distinct from hidden task rows", () => {
  const result = projectWorkOperations({
    taskRead: projectReadResult({ readError: "PERMISSION_DENIED" }, "tasks", "tasks"),
    hasTaskPermission: () => false,
  });
  assert.equal(result.taskRead.status, "unavailable");
  assert.match(result.taskRead.message, /cannot load tasks/i);
});

test("renders lazy assignment actions without loading or exposing people choices", () => {
  const html = render();
  assert.match(html, /Tasks and assignments/);
  assert.match(html, /at most 200 tasks/);
  assert.match(html, /Prepare the client delivery brief/);
  assert.match(html, /Original handoff/);
  assert.match(html, /Change due date/);
  assert.match(html, /Cancel task/);
  assert.match(html, /Assign…/);
  assert.match(html, /Reassign…/);
  assert.doesNotMatch(html, /role="combobox"/);
  assert.doesNotMatch(html, />Reviewer</);
  assert.doesNotMatch(html, /<select\b/);
  assert.doesNotMatch(html, /Confirm cancellation|Keep task/);
});

test("the due-date disclosure replaces browser markers with a touch-sized tokenized chevron", () => {
  const css = fs.readFileSync(path.join(__dirname, "WorkOperations.module.css"), "utf8");
  const summary = css.match(/\.dueDateEditor summary\s*\{([^}]+)\}/)?.[1] || "";
  const chevron = css.match(/\.dueDateEditor summary::after\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(summary, /display:\s*inline-flex/);
  assert.match(summary, /min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(summary, /list-style:\s*none/);
  assert.match(css, /\.dueDateEditor summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/);
  assert.match(chevron, /border-inline-end:\s*1\.5px solid currentColor/);
  assert.match(chevron, /border-block-end:\s*1\.5px solid currentColor/);
  assert.match(css, /\.dueDateEditor\[open\] summary::after/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.dueDateEditor summary::after\s*\{\s*border-color:\s*currentColor/);
});

test("projects client review policy while organisation work can opt into review", () => {
  assert.equal(projected().taskRead.items[0].workstreamKind, "client");
  const organisationTask = { ...task, workstream: { ...task.workstream, kind: "organisation" } };
  const result = projectWorkOperations({
    taskRead: { status: "ready", items: [organisationTask] },
    hasTaskPermission: (permission) => allowed(permission),
  });
  const html = render(result);
  assert.doesNotMatch(html, /Client work requires review/);
  assert.match(html, /Assign…/);
});

test("keeps task actions independent from broad people reads", () => {
  const html = render();
  assert.match(html, /Assign…/);
  assert.match(html, /Reassign…/);
  assert.doesNotMatch(html, /people\.view|Former staff|role="combobox"/);
});

test("withholds task row actions when the server did not mark them eligible", () => {
  const ineligible = { ...task, canAssign: false, canCancel: false, canEditDueDate: false, assignments: [{ ...task.assignments[0], canReassign: false }] };
  const props = projected({ taskRead: { status: "ready", items: [ineligible] } });
  const html = render(props);
  assert.match(html, /Prepare the client delivery brief/);
  assert.doesNotMatch(html, /Cancel task|Assign task|Reassign|Change due date/);
});

test("malformed task rows fail closed instead of partially rendering actions", () => {
  const result = projected({ taskRead: { status: "ready", items: [{ id: "task-broken" }] } });
  assert.equal(result.taskRead.status, "error");
  assert.match(result.taskRead.message, /incomplete/);
});
