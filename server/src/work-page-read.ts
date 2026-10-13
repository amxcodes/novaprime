import { readPage, type PageReadRoute } from "./page-read.js";

const workReadRoutes = new Map<string, PageReadRoute>([
  ["/api/work/assignments/mine", { name: "assignments", query: ["limit", "status", "due", "q", "cursor"] }],
  ["/api/work/timeline", { name: "timeline", query: ["date"] }],
  ["/api/reviews/pending", { name: "reviews", query: ["assignmentId", "taskId"] }],
  ["/api/task-reviewer-requests", { name: "reviewer-requests", query: ["requestId"] }],
  ["/api/task-handover-requests", { name: "handover-requests", query: ["requestId"] }],
  ["/api/work/tasks/visible", { name: "visible-tasks", query: ["limit", "status", "due", "q", "cursor"] }],
  ["/api/task-catalog", { name: "task-catalog", query: [] }],
  ["/api/attendance/today", { name: "attendance", query: [] }],
  ["/api/task-assignments/reviewer-management", { name: "reviewer-management", query: ["limit", "cursor"] }],
]);

const workPageReadOptions = {
  routes: workReadRoutes,
  maxReads: 9,
  timingPrefix: "nova-work",
  failureEvent: "WORK_PAGE_READ_FAILED",
  invalidPlanError: "INVALID_WORK_READ_PLAN",
  includeTimelinePhases: true,
} as const;

type DispatchRead = (request: Request) => Promise<Response>;

/** Dispatch only the bounded Work reads selected by the client-side permission plan. */
export function readWorkPage(request: Request, dispatchRead: DispatchRead): Promise<Response> {
  return readPage(request, dispatchRead, workPageReadOptions);
}
