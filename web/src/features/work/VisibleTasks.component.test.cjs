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
  DEFAULT_VISIBLE_TASK_FILTERS,
  VISIBLE_TASK_DUE_OPTIONS,
  VISIBLE_TASK_STATUS_OPTIONS,
  countVisibleTaskFilters,
  VisibleTasks,
  visibleTaskFiltersFromForm,
} = require("./VisibleTasks.tsx");
const { VisibleTaskBoard } = require("./VisibleTaskBoard.tsx");
const { isCompactWorkContainer } = require("./use-compact-work-container.ts");

const task = {
  id: "task-1",
  title: "Prepare the launch brief",
  description: "Coordinate the final customer-ready summary.",
  status: "in_progress",
  priority: "high",
  dueDate: "2026-10-06",
  createdAt: "2026-10-01T12:00:00.000Z",
  client: { id: "client-1", name: "Northwind" },
  workstream: { id: "workstream-1", name: "Product delivery", kind: "client" },
  group: { id: "group-1", name: "Launch" },
  department: { id: "department-1", name: "Design" },
  assignmentCount: 3,
};

function render(
  filters = { status: "open", due: "any", search: "", cursor: "" },
  read = { status: "ready", data: { tasks: [], hasMore: false, nextCursor: null, limit: 30 } },
  callbacks = {},
) {
  return renderToStaticMarkup(React.createElement(VisibleTasks, {
    read,
    filters,
    taskDetailHref: (id) => `/?view=work&task=${id}`,
    onOpenTask() {},
    onApplyFilters() {},
    onNewer() {},
    onOlder() {},
    ...callbacks,
  }));
}

test("status and due-date options preserve the existing filter values and labels", () => {
  assert.deepEqual(VISIBLE_TASK_STATUS_OPTIONS, [
    ["open", "Open tasks"], ["all", "All statuses"], ["backlog", "Backlog"],
    ["ready", "Ready"], ["in_progress", "In progress"], ["submitted", "Submitted"],
    ["approved", "Approved"], ["done", "Done"], ["blocked", "Blocked"],
    ["returned", "Returned"], ["cancelled", "Cancelled"],
  ]);
  assert.deepEqual(VISIBLE_TASK_DUE_OPTIONS, [
    ["any", "Any due date"], ["overdue", "Overdue"], ["today", "Due today"],
    ["upcoming", "Due in the next 7 days"], ["unscheduled", "No due date"],
  ]);
});

test("finite React Aria filters retain selected values, labels, form names, and clear/apply actions", () => {
  const html = render({ status: "in_progress", due: "upcoming", search: "brief", cursor: "cursor-1" });
  assert.match(html, /<label[^>]*>.*Task status/s);
  assert.match(html, /button[^>]*aria-haspopup="listbox"/);
  assert.match(html, /<select tabindex="-1" name="status">[\s\S]*?<option value="in_progress" selected="">In progress/);
  assert.match(html, /<select tabindex="-1" name="due">[\s\S]*?<option value="upcoming" selected="">Due in the next 7 days/);
  assert.match(html, /<button[^>]*aria-haspopup="listbox"[^>]*>[\s\S]*?In progress/);
  assert.match(html, /<button[^>]*aria-haspopup="listbox"[^>]*>[\s\S]*?Due in the next 7 days/);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
  assert.match(html, /name="search"[^>]*value="brief"/);
  assert.match(html, /Apply filters/);
  assert.match(html, /Clear/);
  assert.match(html, /<summary[^>]*>\s*<span>Filters<\/span>[\s\S]*2 active/);
  assert.equal((html.match(/name="status"/g) || []).length, 1);
  assert.equal((html.match(/name="due"/g) || []).length, 1);
  assert.deepEqual(DEFAULT_VISIBLE_TASK_FILTERS, { status: "open", due: "any", search: "", cursor: "" });
});

test("compact work container boundaries and active filter count stay explicit", () => {
  assert.equal(isCompactWorkContainer(640), true);
  assert.equal(isCompactWorkContainer(641), false);
  assert.equal(isCompactWorkContainer(0), false);
  assert.equal(isCompactWorkContainer(Number.NaN), false);
  assert.equal(countVisibleTaskFilters({ status: "open", due: "any", search: "query", cursor: "" }), 0);
  assert.equal(countVisibleTaskFilters({ status: "submitted", due: "overdue", search: "", cursor: "" }), 2);
});

test("filter submission trims search, preserves selected values, and resets pagination", () => {
  const form = new FormData();
  form.set("status", "submitted");
  form.set("due", "today");
  form.set("search", "  Review brief  ");

  assert.deepEqual(visibleTaskFiltersFromForm(form), {
    status: "submitted", due: "today", search: "Review brief", cursor: "",
  });
});

test("unselected or edited choice text falls back to the default filters", () => {
  const form = new FormData();
  form.set("status", "not-a-status");
  form.set("due", "");

  assert.deepEqual(visibleTaskFiltersFromForm(form), DEFAULT_VISIBLE_TASK_FILTERS);
});

test("populated rows align the five comparison fields and retain a native task-detail link", () => {
  const html = render(undefined, {
    status: "ready",
    data: { tasks: [task], hasMore: true, nextCursor: "opaque-next-cursor", limit: 30 },
  });

  assert.match(html, /Showing 1 task on this page\./);
  assert.doesNotMatch(html, /total|of 1 task/i);
  assert.match(html, /Task/);
  assert.match(html, /Status/);
  assert.match(html, /Priority/);
  assert.match(html, /Due/);
  assert.match(html, /Assignments/);
  assert.match(html, /Prepare the launch brief/);
  assert.match(html, /Client · Northwind/);
  assert.match(html, /Workstream · Product delivery/);
  assert.match(html, /Group · Launch/);
  assert.match(html, /Department · Design/);
  assert.match(html, /In_progress|In progress/);
  assert.match(html, /High/);
  assert.match(html, /2026/);
  assert.match(html, />3</);
  assert.match(html, /<a [^>]*href="\/\?view=work&amp;task=task-1">Prepare the launch brief<\/a>/);
  assert.match(html, /data-task-detail-id="task-1" data-task-detail-source="visible"/);
  assert.doesNotMatch(html, /<a[^>]*role="button"/);
});

test("board mode groups existing task states without exposing a status-changing drag action", () => {
  const boardTask = { ...task, status: "submitted", title: "Review the launch brief" };
  const html = renderToStaticMarkup(React.createElement(VisibleTaskBoard, {
    tasks: [boardTask, { ...task, id: "task-2", status: "blocked", title: "Resolve the blocked handoff" }],
    taskDetailHref: (id) => `/?view=work&task=${id}`,
    onOpenTask() {},
  }));

  assert.match(html, /Visible tasks grouped by status/);
  assert.match(html, /current page/);
  assert.match(html, /Task status is managed by the work workflow/);
  assert.match(html, /In review/);
  assert.match(html, /Needs attention/);
  assert.match(html, /1 on this page/);
  assert.match(html, /Review the launch brief/);
  assert.match(html, /Resolve the blocked handoff/);
  assert.match(html, /<a [^>]*href="\/\?view=work&amp;task=task-1">Review the launch brief<\/a>/);
  assert.match(html, /data-task-detail-id="task-1" data-task-detail-source="visible"/);
  assert.doesNotMatch(html, /draggable=|drop target/i);
});

test("Work exposes an explicit accessible list/board switch and keeps list as the default", () => {
  const list = render(undefined, {
    status: "ready",
    data: { tasks: [task], hasMore: false, nextCursor: null, limit: 30 },
  });
  assert.match(list, /role="group" aria-label="Task layout"/);
  assert.match(list, /<summary[^>]*>\s*<span>More actions<\/span>/);
  assert.match(list, /<button aria-pressed="true"[^>]*>[\s\S]*?<span>List<\/span><\/button>/);
  assert.match(list, /<button aria-pressed="false"[^>]*>[\s\S]*?<span>Board<\/span><\/button>/);
  assert.match(list, /<ul[^>]*aria-label="Visible tasks"/);

  const board = render(undefined, {
    status: "ready",
    data: { tasks: [task], hasMore: false, nextCursor: null, limit: 30 },
  }, { displayMode: "board" });
  assert.match(board, /<button aria-pressed="true"[^>]*>[\s\S]*?<span>Board<\/span><\/button>/);
  assert.match(board, /Visible tasks grouped by status/);
  assert.doesNotMatch(board, /aria-label="Visible tasks"/);
});

test("board layout supplies compact lane navigation and wider multi-column arrangements", () => {
  const source = fs.readFileSync(require.resolve("./VisibleTaskBoard.module.css"), "utf8");
  assert.match(source, /@container visible-tasks \(max-width: 47\.999rem\)/);
  assert.match(source, /\.lanePicker\s*\{\s*display:\s*block/);
  assert.match(source, /\.lane:not\(\[data-active="true"\]\)\s*\{\s*display:\s*none/);
  assert.match(source, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(source, /overflow-x:\s*(?:scroll|auto)/);
});

test("cursor controls expose only the valid direction and keep page copy free of totals", () => {
  const firstPage = render(undefined, {
    status: "ready",
    data: { tasks: [task], hasMore: true, nextCursor: "older-cursor", limit: 30 },
  });
  const laterFinalPage = render(
    { status: "open", due: "any", search: "brief", cursor: "current-cursor" },
    { status: "ready", data: { tasks: [task], hasMore: false, nextCursor: null, limit: 30 } },
  );

  assert.match(firstPage, /Older tasks/);
  assert.doesNotMatch(firstPage, /Newer tasks/);
  assert.match(firstPage, /Showing 1 task on this page\./);
  assert.doesNotMatch(firstPage, /of 30|total/i);
  assert.match(laterFinalPage, /Newer tasks/);
  assert.doesNotMatch(laterFinalPage, /Older tasks/);
  assert.match(laterFinalPage, /Showing 1 task on this page\./);
});

test("focus requests land on the visible error heading when a collection cannot render its requested control", () => {
  const source = fs.readFileSync(require.resolve("./VisibleTasks.tsx"), "utf8");
  assert.match(source, /if \(read\.status === "loading"\) return;/);
  assert.match(source, /read\.status === "denied" \|\| read\.status === "error"\s*\? heading\.current/);
  assert.match(source, /if \(target === heading\.current\) target\.tabIndex = -1;[\s\S]*?target\.focus\(\{ preventScroll: true \}\)/);
});

test("comparison rows keep aligned task and fact tracks with compact labeled layouts", () => {
  const css = fs.readFileSync(require.resolve("./VisibleTasks.module.css"), "utf8");
  assert.match(css, /\.item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.facts\s*\{\s*display:\s*contents/);
  assert.match(css, /\.facts dt\s*\{[^}]*position:\s*absolute[^}]*clip:\s*rect\(0, 0, 0, 0\)/);
  assert.match(css, /@container visible-tasks\s*\(max-width:\s*60rem\)[\s\S]*?\.facts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@container visible-tasks\s*\(max-width:\s*60rem\)[\s\S]*?\.facts dt\s*\{\s*position:\s*static/);
  assert.match(css, /@container visible-tasks\s*\(max-width:\s*40rem\)[\s\S]*?\.facts\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?\.title a\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /\.section :global\(:focus-visible\)/);
});
