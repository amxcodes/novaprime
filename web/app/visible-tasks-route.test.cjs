const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const routeUrl = pathToFileURL(path.join(__dirname, "visible-tasks-route.js"));
let project;
let readDisplayMode;
let displayHref;

test("loads the ESM route adapter", async () => {
  ({
    projectVisibleTasksRead: project,
    readVisibleTaskDisplayMode: readDisplayMode,
    visibleTaskDisplayHref: displayHref,
  } = await import(routeUrl.href));
});

test("board/list presentation state round-trips through the Work URL without entering API query state", () => {
  assert.equal(readDisplayMode("?view=work&taskLayout=board&taskStatus=in_progress"), "board");
  assert.equal(readDisplayMode("?view=work&taskLayout=unsupported"), "list");
  assert.equal(readDisplayMode("?view=work"), "list");

  const board = new URL(displayHref(
    "https://nova.example/?view=work&taskStatus=in_progress&taskDue=today&task=task-1&taskLayout=list#task",
    "board",
  ), "https://nova.example");
  assert.equal(board.pathname, "/");
  assert.equal(board.searchParams.get("view"), "work");
  assert.equal(board.searchParams.get("taskStatus"), "in_progress");
  assert.equal(board.searchParams.get("taskDue"), "today");
  assert.equal(board.searchParams.get("taskLayout"), "board");
  assert.equal(board.searchParams.has("task"), false);
  assert.equal(board.hash, "");

  const list = new URL(displayHref(board.href, "list"), "https://nova.example");
  assert.equal(list.searchParams.has("taskLayout"), false);
  assert.equal(list.searchParams.get("taskStatus"), "in_progress");
});

function task(overrides = {}) {
  return {
    id: "task-1",
    title: "Prepare the delivery brief",
    description: "Write the client handoff.",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-10-10",
    createdAt: "2026-10-01T10:00:00.000Z",
    client: { id: "client-1", name: "Example Client" },
    workstream: { id: "stream-1", name: "Launch", kind: "client" },
    group: { id: "group-1", name: "Delivery" },
    department: null,
    assignmentCount: 2,
    assignmentNames: ["must not reach UI"],
    internalNotes: "must not reach UI",
    ...overrides,
  };
}

function page(overrides = {}) {
  return { tasks: [task()], hasMore: true, nextCursor: "cursor-next", limit: 30, ...overrides };
}

function readIssue(result, resource) {
  return result?.readError ? { message: `${resource}: ${result.readError}` } : undefined;
}

test("projects the documented task/page fields and drops extra server properties", () => {
  const projected = project(page(), readIssue);
  assert.equal(projected.status, "ready");
  assert.deepEqual(projected.data, {
    tasks: [{
      id: "task-1",
      title: "Prepare the delivery brief",
      description: "Write the client handoff.",
      status: "in_progress",
      priority: "high",
      dueDate: "2026-10-10",
      createdAt: "2026-10-01T10:00:00.000Z",
      client: { id: "client-1", name: "Example Client" },
      workstream: { id: "stream-1", name: "Launch", kind: "client" },
      group: { id: "group-1", name: "Delivery" },
      department: null,
      assignmentCount: 2,
    }],
    hasMore: true,
    nextCursor: "cursor-next",
    limit: 30,
  });
  assert.doesNotMatch(JSON.stringify(projected), /assignmentNames|internalNotes/);
});

test("preserves denied versus recoverable read failures", () => {
  const retry = () => {};
  assert.deepEqual(project({ readError: "PERMISSION_DENIED" }, readIssue, retry), {
    status: "denied",
    message: "visible tasks: PERMISSION_DENIED",
  });
  const failed = project({ readError: "REQUEST_FAILED" }, readIssue, retry);
  assert.equal(failed.status, "error");
  assert.equal(failed.onRetry, retry);
  assert.match(failed.message, /REQUEST_FAILED/);
});

test("accepts an honest empty page and validates cursor, page size, and unique task identities", () => {
  const empty = project({ tasks: [], hasMore: false, nextCursor: null, limit: 30 }, readIssue);
  assert.deepEqual(empty, { status: "ready", data: { tasks: [], hasMore: false, nextCursor: null, limit: 30 } });

  for (const invalid of [
    { tasks: null },
    { hasMore: true, nextCursor: null },
    { hasMore: false, nextCursor: "cursor-next" },
    { limit: 0 },
    { limit: 101 },
    { tasks: [task(), task({ id: "task-1" })] },
  ]) {
    assert.equal(project(page(invalid), readIssue).status, "error", JSON.stringify(invalid));
  }
});

test("rejects malformed records and unsafe nested summaries instead of rendering partial rows", () => {
  for (const invalidTask of [
    task({ id: "" }),
    task({ createdAt: "not-a-date" }),
    task({ dueDate: "2026-02-30" }),
    task({ assignmentCount: -1 }),
    task({ workstream: { id: "stream-1", name: "Launch", kind: "other" } }),
    task({ client: null }),
    task({ group: { id: "group-1", name: 1 } }),
  ]) {
    const projected = project(page({ tasks: [invalidTask], hasMore: false, nextCursor: null }), readIssue);
    assert.equal(projected.status, "error");
    assert.equal("data" in projected, false);
  }
});

test("keeps visible task reads grant-planned and passes only the projected read to React", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const reads = fs.readFileSync(path.join(__dirname, "work-read-route.js"), "utf8");
  const featureLoader = fs.readFileSync(path.join(__dirname, "work-route-features.js"), "utf8");
  const workRoute = fs.readFileSync(path.join(__dirname, "work-route.js"), "utf8");
  assert.match(featureLoader, /import\("\.\/visible-tasks-route\.js"\)/);
  assert.match(reads, /read\(nonFocusedFeatureReads && readPlan\.taskCollection,[\s\S]*?visibleTaskReadUrl\(visibleTaskFilter\)/);
  assert.match(app, /const visibleTasksRead = visibleTasksRoute\?\.projectVisibleTasksRead\?\.\(/);
  assert.match(app, /VisibleTasks,\s*\{\s*read: visibleTasksRead/);
  assert.match(app, /displayMode: visibleTasksRoute\.readVisibleTaskDisplayMode\(window\.location\.search\)/);
  assert.match(app, /visibleTasksRoute\.visibleTaskDisplayHref\(window\.location\.href, displayMode\)/);
  assert.match(workRoute, /"taskCursor",\s*"taskLayout"/);
  assert.match(app, /a\[data-task-detail-id\]/);
});
