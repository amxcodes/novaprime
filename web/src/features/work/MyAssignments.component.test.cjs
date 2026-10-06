const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  isEligibleAssignmentCandidate,
  countAssignmentFilters,
  MyAssignments,
  validateAssignmentCandidateRequest,
} = require("./MyAssignments.tsx");

function render(filters = { status: "all", due: "any", search: "", cursor: "" }, canViewTask = true, overrides = {}, taskDetailHref = (taskId) => `/?view=work&task=${taskId}`) {
  const assignment = {
    assignmentId: "assignment-1",
    taskId: "task-1",
    title: "Prepare the delivery brief",
    canViewTask,
    status: "assigned",
    dueDate: null,
    dueDateRevision: 0,
    canEditDueDate: false,
    canStart: false,
    canSubmit: false,
    canRequestReviewer: true,
    canRequestHandover: false,
    hasPendingReviewerRequest: false,
    hasPendingHandoverRequest: false,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(MyAssignments, {
    read: { status: "ready", data: { assignments: [assignment], hasMore: false, nextCursor: null, limit: 30 } },
    filters,
    savedViews: React.createElement("button", { type: "button" }, "Saved view"),
    taskDetailHref,
    onApplyFilters() {},
    onClearFilters() {},
    onOpenTask() {},
    onStart() {},
    onSubmit() {},
    onLoadCandidates: async () => ({ reviewers: [], handoverTargets: [] }),
    onSaveDueDate() {},
    onRequestReviewer() {},
    onRequestHandover() {},
    onOlder() {},
    onNewer() {},
  }));
}

test("assignment filters use authored controls and preserve form names and selected values", () => {
  const html = render({ status: "submitted", due: "overdue", search: "brief", cursor: "page-2" });

  assert.match(html, /button[^>]*aria-haspopup="listbox"/);
  assert.match(html, /<select tabindex="-1" name="status">[\s\S]*?<option value="submitted" selected="">Submitted/);
  assert.match(html, /<select tabindex="-1" name="due">[\s\S]*?<option value="overdue" selected="">Overdue/);
  assert.match(html, /<button[^>]*aria-haspopup="listbox"[^>]*>[\s\S]*?Submitted/);
  assert.match(html, /<button[^>]*aria-haspopup="listbox"[^>]*>[\s\S]*?Overdue/);
  assert.match(html, /name="search"[^>]*value="brief"/);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
  assert.match(html, /Apply filters/);
  assert.match(html, /Clear/);
  assert.match(html, /<summary[^>]*>\s*<span>Filters<\/span>[\s\S]*2 active/);
  assert.equal((html.match(/name="status"/g) || []).length, 1);
  assert.equal((html.match(/name="due"/g) || []).length, 1);
  assert.match(html, /<summary[^>]*>\s*<span>More actions<\/span>/);
  assert.match(html, /Saved view/);
});

test("assignment filter count ignores search and follows the filter defaults", () => {
  assert.equal(countAssignmentFilters({ status: "all", due: "any", search: "query", cursor: "" }), 0);
  assert.equal(countAssignmentFilters({ status: "submitted", due: "overdue", search: "", cursor: "" }), 2);
});

test("task detail is linked only when the current projection grants task visibility", () => {
  assert.ok(render(undefined, true).includes('href="/?view=work&amp;task=task-1"'));
  assert.doesNotMatch(render(undefined, false), /<a\b/);
  let detailHrefCalls = 0;
  render(undefined, false, {}, () => { detailHrefCalls += 1; return "/?view=work&task=task-1"; });
  assert.equal(detailHrefCalls, 0);
});

test("assignments without server-authorized actions do not leave an empty action column", () => {
  const html = render(undefined, true, {
    canStart: false,
    canSubmit: false,
    canEditDueDate: false,
    canRequestReviewer: false,
    canRequestHandover: false,
  });
  assert.match(html, /<span(?: class="[^"]+")?>No actions available<\/span>/);
});

test("My Assignments keeps one semantic list with aligned populated comparison fields", () => {
  const html = render(undefined, true, {
    status: "in_progress",
    dueDate: "2026-10-12",
    canStart: true,
    canSubmit: true,
    canEditDueDate: true,
    canRequestHandover: true,
  });

  assert.match(html, /aria-hidden="true"><span>Assignment<\/span><span>Status<\/span><span>Due date<\/span><span>Available actions<\/span>/);
  assert.match(html, /<ul aria-label="Your assignments">[\s\S]*<li>[\s\S]*<h3><a href="\/\?view=work&amp;task=task-1">/);
  assert.match(html, /<span>Status<\/span>[\s\S]*In progress/);
  assert.match(html, /<span>Due date<\/span>[\s\S]*<time dateTime="2026-10-12">/);
  assert.match(html, /Start \/ resume/);
  assert.match(html, />Submit</);
  assert.match(html, /Change due date/);
  assert.match(html, /Request reviewer or handover/);
});

test("action-only assignments retain permitted actions without exposing task links or task-only context", () => {
  const html = render(undefined, false, {
    canStart: true,
    canSubmit: true,
    canRequestReviewer: true,
    billingClass: "billable",
    taskDefinition: { entryId: "catalog-1", revision: 3 },
  });

  assert.doesNotMatch(html, /<a\b/);
  assert.doesNotMatch(html, /Billable|Task definition/);
  assert.match(html, /Start \/ resume/);
  assert.match(html, />Submit</);
  assert.match(html, /Request a reviewer/);
});

test("eligible teammate reads remain lazy until the collaboration disclosure is opened", () => {
  let reads = 0;
  const props = {
    read: { status: "ready", data: { assignments: [], hasMore: false, nextCursor: null, limit: 30 } },
    filters: { status: "all", due: "any", search: "", cursor: "" },
    taskDetailHref: () => "/",
    onApplyFilters() {}, onClearFilters() {}, onOpenTask() {}, onStart() {}, onSubmit() {},
    onLoadCandidates: async () => { reads += 1; return { reviewers: [], handoverTargets: [] }; },
    onSaveDueDate() {}, onRequestReviewer() {}, onRequestHandover() {}, onOlder() {}, onNewer() {},
  };

  renderToStaticMarkup(React.createElement(MyAssignments, props));
  assert.equal(reads, 0);
});

test("candidate IDs must come from the current eligible option set", () => {
  const currentCandidates = [{ id: "person-1", displayName: "Aman Verma" }];

  assert.equal(isEligibleAssignmentCandidate("person-1", currentCandidates), true);
  assert.equal(isEligibleAssignmentCandidate("person-2", currentCandidates), false);
  assert.equal(isEligibleAssignmentCandidate("", currentCandidates), false);
});

test("candidate request validation reports selection and reason errors before submission", () => {
  const currentCandidates = [{ id: "person-1", displayName: "Aman Verma" }];

  assert.equal(validateAssignmentCandidateRequest("stale-id", currentCandidates, "Reason"), "candidate");
  assert.equal(validateAssignmentCandidateRequest("person-1", currentCandidates, "   "), "reason");
  assert.equal(validateAssignmentCandidateRequest("person-1", currentCandidates, "Reason"), null);
});
