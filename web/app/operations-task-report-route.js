import { createOperationsTaskReportController } from "../src/features/operations/task-report-controller.ts";

export const OPERATIONS_TASK_PAGE_LIMIT = 30;

export function operationsTaskPageUrl(cursor = null) {
  const query = new URLSearchParams({
    limit: String(OPERATIONS_TASK_PAGE_LIMIT),
    status: "all",
  });
  if (typeof cursor === "string" && cursor) query.set("cursor", cursor);
  return `/api/work/tasks/visible?${query.toString()}`;
}

/** Bind the Operations page lifecycle to the existing scope-filtered task summary read. */
export function createOperationsTaskReportRoute({
  read,
  isCurrent = () => true,
  onChange = () => {},
  failureMessage,
  deniedMessage,
} = {}) {
  if (typeof read !== "function") throw new TypeError("read must be a function");
  return createOperationsTaskReportController({
    readPage: (cursor) => read(operationsTaskPageUrl(cursor)),
    isCurrent,
    onChange,
    failureMessage,
    deniedMessage,
  });
}
