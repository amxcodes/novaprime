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
const { TaskDetail } = require("./TaskDetail.tsx");

const task = {
  title: "Quarterly metrics",
  description: "Prepare the client report.",
  status: "in_progress",
  priority: "high",
  createdAt: "2026-09-01T10:30:00.000Z",
  dueDate: "2026-10-20",
  canEditDueDate: true,
  billingClass: "billable",
  billingPolicySource: "client_workstream",
  billingPolicyRevision: 4,
  taskDefinitionRevision: 3,
  isCorrection: true,
  correctionReason: "Source figures changed",
  correctionTitle: "Original report",
  clientName: "Northwind",
  workstreamName: "Reporting",
  workstreamKind: "client",
  groupName: "Finance",
  departmentName: null,
  assignments: [
    {
      personName: "Aman",
      reviewerName: "Riya",
      reviewRequired: true,
      reviewBlockedReason: "missing_evidence",
      status: "in_progress",
    },
  ],
};

function render(read = { status: "ready", data: task }, props = {}) {
  return renderToStaticMarkup(React.createElement(TaskDetail, {
    read,
    onBack() {},
    onRetry() {},
    async onSaveDueDate() {
      return { status: "saved", dueDate: "2026-10-20", message: "Due date saved." };
    },
    ...props,
  }));
}

test("ready view uses a clear heading hierarchy and presents only the supplied assignment rows", () => {
  const html = render();
  assert.match(html, /<article[^>]*aria-labelledby=/);
  assert.match(html, /<h2[^>]*>Quarterly metrics<\/h2>/);
  assert.equal((html.match(/<h3\b/g) || []).length, 4);
  assert.match(html, /aria-labelledby="[^"]+-context-heading"/);
  assert.match(html, /<h3[^>]*>Work context<\/h3>/);
  assert.match(html, /<h3[^>]*>Visible assignments<\/h3>/);
  assert.match(html, /Only assignment details available to this view are shown\./);
  assert.match(html, /Aman/);
  assert.match(html, /Reviewer: Riya/);
  assert.match(html, /Review blocked: missing evidence/);
  assert.match(html, /Correction task for “Original report” · Source figures changed/);
  assert.doesNotMatch(html, /<h1\b/);
});

test("assignment empty state does not imply the task has no assignments overall", () => {
  const html = render({ status: "ready", data: { ...task, assignments: [] } });
  assert.match(html, /No assignments are available in this view\./);
  assert.match(html, /Only assignment details available to this view are shown\./);
  assert.doesNotMatch(html, /No assignments are attached to this task/);
});

test("due-date controls require capability and a non-terminal task state", () => {
  const editable = render();
  assert.match(editable, /<details[^>]*><summary>Change due date<\/summary>/);
  assert.match(editable, /Change due date/);
  assert.match(editable, /type="date"[^>]*name="dueDate"[^>]*value="2026-10-20"/);
  assert.match(editable, /Save due date/);

  assert.doesNotMatch(render({ status: "ready", data: { ...task, canEditDueDate: false } }), /Change due date/);
  for (const status of ["approved", "done", "cancelled"]) {
    assert.doesNotMatch(render({ status: "ready", data: { ...task, status } }), /Change due date/);
  }
});

test("loading and unavailable reads keep distinct accessible actions", () => {
  const loading = render({ status: "loading" });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /<h2[^>]*>Task details<\/h2>/);
  assert.match(loading, /Loading task details/);

  const unavailable = render({ status: "unavailable", message: "This task is not available to your account.", canRetry: false });
  assert.match(unavailable, /<h2[^>]*>Task unavailable<\/h2>/);
  assert.match(unavailable, /This task is not available to your account\./);
  assert.match(unavailable, /Back/);
  assert.doesNotMatch(unavailable, /Try again/);

  const retryable = render({ status: "unavailable", message: "Connection failed.", canRetry: true });
  assert.match(retryable, /Connection failed\./);
  assert.match(retryable, /Try again/);
});

test("due-date conflict, reload, and save feedback paths remain explicit", () => {
  // SSR cannot dispatch form events, so assert the component's state transitions and rendered feedback branches.
  const source = fs.readFileSync(path.join(__dirname, "TaskDetail.tsx"), "utf8");
  assert.match(source, /result\.status === "saving"/);
  assert.match(source, /result\.status === "saved" \|\| result\.status === "unchanged"/);
  assert.match(source, /result\.status === "error"/);
  assert.match(source, /result\.status === "conflict"/);
  assert.match(source, /disabled=\{result\.status === "saving" \|\| result\.status === "conflict"\}/);
  assert.match(source, /disabled=\{result\.status === "conflict"\}/);
  assert.match(source, /<StateMessage kind="warning">\{result\.message\}<\/StateMessage>/);
  assert.match(source, /Reload task/);
  assert.match(source, /onClick=\{onRetry\}/);
  assert.match(source, /if \(saved\.status === "aborted"\) return/);
});

test("responsive feature styling uses defined semantic tokens and narrow container layouts", () => {
  const css = fs.readFileSync(path.join(__dirname, "TaskDetail.module.css"), "utf8");
  const pageCss = fs.readFileSync(path.join(__dirname, "../WorkPage.module.css"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "../../../../app.js"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];

  assert.ok(css.includes("container: work-task-detail / inline-size"));
  assert.match(css, /@container work-task-detail \(max-width: 42rem\)/);
  assert.match(css, /@container work-task-detail \(max-width: 30rem\)/);
  assert.match(css, /\.fields,\s*\.assignment\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.title\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.field dd\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.description\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.assignmentMeta,\s*\.blocker\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?--nova-control-touch-target/);
  assert.match(pageCss, /\.section\[data-section="task-detail"\][\s\S]*?grid-column: 1 \/ -1/);
  assert.match(appSource, /if \(taskDetailRoute\) \{[\s\S]*?mountWorkPage\(workPageUi\.createWorkPageSections\(readPlan,[\s\S]*?taskDetailRoute,/);
  assert.match(appSource, /const taskDetailRoot = workSlot\("task-detail"\)/);
  assert.match(appSource, /await workTaskDetailRoute\(\{ taskId, board: taskDetailRoot, lifetime, Component: taskDetailUi\.module\.TaskDetail \}\)/,
    "the route mounts task detail into its feature-owned page slot");
  assert.ok(referenced.length > 0);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});

test("task-detail disclosure replaces the browser marker with a clear, accessible open state", () => {
  const css = fs.readFileSync(path.join(__dirname, "TaskDetail.module.css"), "utf8");
  const html = render();

  assert.match(html, /<details[^>]*><summary>Change due date<\/summary>/);
  assert.match(css, /summary\s*\{[^}]*list-style:\s*none/s);
  assert.match(css, /summary::marker\s*\{[^}]*content:\s*""/s);
  assert.match(css, /summary::-webkit-details-marker\s*\{\s*display:\s*none/s);
  assert.match(css, /summary::after\s*\{[^}]*border-inline-end:\s*1\.5px solid currentColor;[^}]*border-block-end:\s*1\.5px solid currentColor/s);
  assert.match(css, /\.dueEditor\[open\] summary::after/);
  assert.match(css, /summary:focus-visible\s*\{[^}]*outline:/s);
  assert.doesNotMatch(html, /role="button"/);
});

test("the due-date form keeps touch actions, reduced motion, and forced-color states usable", () => {
  const css = fs.readFileSync(path.join(__dirname, "TaskDetail.module.css"), "utf8");
  const reset = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/reset.css"), "utf8");
  const html = render();

  assert.match(html, /<form>/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>.*Save due date/s);
  assert.match(css, /\.dueForm\s*\{[^}]*gap:\s*var\(--nova-space-3\)/s);
  assert.match(css, /\.dueForm\s*\{[^}]*padding:\s*var\(--nova-space-3\)/s);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?\.dueForm input,[\s\S]*?min-height: var\(--nova-control-touch-target\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?summary::after\s*\{[^}]*transition:\s*none/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.dueEditor summary::after\s*\{[^}]*border-color:\s*currentColor/s);
  assert.match(reset, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*0\.01ms/s);
});

test("long task, context, and assignment labels retain content for narrow phone wrapping", () => {
  const longTitle = "A very long task title that must remain readable on a 320 pixel phone without forcing a horizontal scroll";
  const longLabel = "A client or department name that is intentionally much longer than the ordinary display label";
  const html = render({ status: "ready", data: {
    ...task,
    title: longTitle,
    clientName: longLabel,
    assignments: [{
      ...task.assignments[0],
      personName: longLabel,
      status: "in_progress_with_a_long_server_state_label",
    }],
  } });

  assert.ok(html.includes(longTitle));
  assert.ok(html.includes(longLabel));
  assert.match(html, /in progress with a long server state label/);
});
