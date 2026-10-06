const deniedReadCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);

export function readVisibleTaskDisplayMode(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search || ""));
  return params.get("taskLayout") === "board" ? "board" : "list";
}

/** Keep collection filters in the URL while treating board/list as page presentation state. */
export function visibleTaskDisplayHref(currentUrl, displayMode) {
  const url = new URL(currentUrl);
  url.pathname = "/";
  url.hash = "";
  url.searchParams.set("view", "work");
  url.searchParams.delete("task");
  url.searchParams.delete("review");
  if (displayMode === "board") url.searchParams.set("taskLayout", "board");
  else url.searchParams.delete("taskLayout");
  return url.pathname + url.search;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string";
}

function isInstant(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isDateOnly(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function projectNamedRecord(value, nullable = true) {
  if (value === null && nullable) return { valid: true, value: null };
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string") {
    return { valid: false };
  }
  return { valid: true, value: { id: value.id, name: value.name } };
}

function projectTask(value) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      !isText(value.title) || !(value.description === null || isText(value.description)) ||
      !isText(value.status) || !isText(value.priority) ||
      !(value.dueDate === null || isDateOnly(value.dueDate)) || !isInstant(value.createdAt) ||
      !Number.isSafeInteger(value.assignmentCount) || value.assignmentCount < 0) return null;

  const client = projectNamedRecord(value.client);
  const group = projectNamedRecord(value.group);
  const department = projectNamedRecord(value.department);
  if (!client.valid || !group.valid || !department.valid) return null;
  if (!isRecord(value.workstream) || typeof value.workstream.id !== "string" || !value.workstream.id ||
      typeof value.workstream.name !== "string" ||
      !["client", "organisation"].includes(value.workstream.kind)) return null;
  if ((value.workstream.kind === "client") !== (client.value !== null)) return null;

  return {
    id: value.id,
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    dueDate: value.dueDate,
    createdAt: value.createdAt,
    client: client.value,
    workstream: { id: value.workstream.id, name: value.workstream.name, kind: value.workstream.kind },
    group: group.value,
    department: department.value,
    assignmentCount: value.assignmentCount,
  };
}

/** Project the bounded, server-authorized visible-task page into its UI contract. */
export function projectVisibleTasksRead(result, readIssue, onRetry) {
  if (typeof readIssue !== "function") throw new TypeError("Visible Tasks readIssue must be a function");
  const issue = readIssue(result, "visible tasks");
  if (issue) {
    const denied = deniedReadCodes.has(result?.readError);
    return {
      status: denied ? "denied" : "error",
      message: typeof issue.message === "string" ? issue.message : "Visible tasks could not load. Refresh Work to try again.",
      ...(!denied && typeof onRetry === "function" ? { onRetry } : {}),
    };
  }

  if (!Array.isArray(result?.tasks) || typeof result.hasMore !== "boolean" ||
      !Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 100 ||
      result.tasks.length > result.limit ||
      !(result.nextCursor === null || (typeof result.nextCursor === "string" && result.nextCursor.length > 0)) ||
      (result.hasMore !== Boolean(result.nextCursor))) {
    return visibleTaskReadError(onRetry);
  }

  const tasks = result.tasks.map(projectTask);
  const ids = new Set();
  for (const task of tasks) {
    if (!task || ids.has(task.id)) return visibleTaskReadError(onRetry);
    ids.add(task.id);
  }

  return {
    status: "ready",
    data: { tasks, hasMore: result.hasMore, nextCursor: result.nextCursor, limit: result.limit },
  };
}

function visibleTaskReadError(onRetry) {
  return {
    status: "error",
    message: "Visible tasks could not be read. Refresh Work to try again.",
    ...(typeof onRetry === "function" ? { onRetry } : {}),
  };
}
