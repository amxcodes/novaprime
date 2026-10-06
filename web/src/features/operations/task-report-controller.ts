import type { OperationsTask, OperationsTasksPage, OperationsTasksReadState } from "./contracts";

export interface OperationsTasksPageResult {
  tasks?: readonly unknown[];
  hasMore?: boolean;
  nextCursor?: string | null;
  limit?: number;
  readError?: string;
  readStatus?: number;
}

export interface OperationsTaskReportControllerOptions {
  readPage: (cursor: string | null) => Promise<OperationsTasksPageResult>;
  isCurrent?: () => boolean;
  onChange?: (read: OperationsTasksReadState) => void;
  isDenied?: (result: OperationsTasksPageResult) => boolean;
  failureMessage?: (result: OperationsTasksPageResult) => string;
  deniedMessage?: string;
}

const fallbackLimit = 30;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalName(value: unknown): { name: string } | null {
  if (!record(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  return { name: value.name.trim() };
}

function projectTask(value: unknown): OperationsTask | null {
  if (!record(value) || typeof value.id !== "string" || !value.id.trim() ||
      typeof value.title !== "string" || typeof value.status !== "string" ||
      typeof value.priority !== "string" ||
      !Number.isSafeInteger(value.assignmentCount) || Number(value.assignmentCount) < 0 ||
      !(value.dueDate === null || typeof value.dueDate === "string")) return null;

  return {
    id: value.id,
    title: value.title,
    status: value.status,
    priority: value.priority,
    dueDate: value.dueDate,
    assignmentCount: Number(value.assignmentCount),
    client: optionalName(value.client),
    workstream: optionalName(value.workstream),
    group: optionalName(value.group),
    department: optionalName(value.department),
  };
}

/** Keeps Operations task rows on the server's scope-filtered cursor contract. */
export function createOperationsTaskReportController({
  readPage,
  isCurrent = () => true,
  onChange = () => {},
  isDenied = (result) => result.readError === "PERMISSION_DENIED" || result.readStatus === 403,
  failureMessage = () => "The task report could not load. Retry this page.",
  deniedMessage = "You do not have permission to view tasks in this scope.",
}: OperationsTaskReportControllerOptions) {
  let generation = 0;
  let cursors: Array<string | null> = [null];
  let read: OperationsTasksReadState = { status: "loading" };
  let pendingPage: { direction: "next" | "previous"; cursor: string | null } | null = null;

  const publish = (next: OperationsTasksReadState) => {
    read = next;
    onChange(read);
  };

  const projectPage = (
    result: OperationsTasksPageResult,
    requestedCursor: string | null,
    direction?: "next" | "previous",
  ): OperationsTasksPage | null => {
    if (!Array.isArray(result.tasks) || typeof result.hasMore !== "boolean" ||
        !Number.isSafeInteger(result.limit) || Number(result.limit) < 1 || Number(result.limit) > 100) return null;
    if (result.tasks.length > Number(result.limit)) return null;
    const tasks = result.tasks.map(projectTask);
    if (tasks.some((task) => task === null)) return null;
    const nextCursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    if ((result.hasMore && (!nextCursor || nextCursor === requestedCursor ||
        (direction !== "previous" && cursors.includes(nextCursor)))) ||
        (!result.hasMore && nextCursor)) return null;
    return {
      tasks: tasks as OperationsTask[],
      cursor: requestedCursor,
      limit: Number(result.limit),
      hasMore: result.hasMore,
      nextCursor: result.hasMore ? nextCursor : null,
      pageNumber: 1,
      hasPrevious: false,
    };
  };

  async function load(cursor: string | null, direction?: "next" | "previous", reset = false) {
    if (!isCurrent()) return read;
    const requestGeneration = reset ? ++generation : generation;
    pendingPage = direction ? { direction, cursor } : null;
    if (read.status === "ready" && !reset) {
      publish({ ...read, loadingPage: true, pageError: undefined });
    } else {
      publish({ status: "loading" });
    }

    let result: OperationsTasksPageResult;
    try {
      result = await readPage(cursor);
    } catch (error) {
      const failure = error as { code?: string; httpStatus?: number } | undefined;
      result = {
        readError: failure?.code || "REQUEST_FAILED",
        readStatus: failure?.httpStatus,
      };
    }
    if (!isCurrent() || requestGeneration !== generation) return read;

    if (result.readError) {
      if (isDenied(result)) {
        pendingPage = null;
        cursors = [null];
        publish({ status: "denied", message: deniedMessage });
      } else if (read.status === "ready") {
        publish({ ...read, loadingPage: false, pageError: failureMessage(result) });
      } else {
        publish({ status: "error", message: failureMessage(result) });
      }
      return read;
    }

    const data = projectPage(result, cursor, direction);
    if (!data) {
      const message = "The task page response was incomplete. Retry loading this page.";
      if (read.status === "ready") publish({ ...read, loadingPage: false, pageError: message });
      else publish({ status: "error", message });
      return read;
    }

    if (direction === "next") cursors = [...cursors, cursor];
    else if (direction === "previous") cursors = cursors.slice(0, -1);
    else if (reset) cursors = [null];
    pendingPage = null;
    data.pageNumber = cursors.length;
    data.hasPrevious = cursors.length > 1;
    publish({ status: "ready", data, loadingPage: false });
    return read;
  }

  function navigate(direction: "next" | "previous") {
    if (!isCurrent() || read.status !== "ready" || read.loadingPage) return Promise.resolve(read);
    const lastIndex = cursors.length - 1;
    const cursor = direction === "next"
      ? (read.data.hasMore ? read.data.nextCursor : null)
      : (lastIndex > 0 ? cursors[lastIndex - 1] : null);
    if (cursor === null && direction === "next") return Promise.resolve(read);
    if (direction === "previous" && lastIndex === 0) return Promise.resolve(read);
    return load(cursor, direction);
  }

  return {
    start: () => load(null, undefined, true),
    next: (cursor?: string) => {
      if (cursor && (read.status !== "ready" || read.data.nextCursor !== cursor)) return Promise.resolve(read);
      return navigate("next");
    },
    previous: () => navigate("previous"),
    retry: () => pendingPage ? load(pendingPage.cursor, pendingPage.direction) :
      load(read.status === "ready" ? read.data.cursor : null),
    getState: () => read,
  };
}
