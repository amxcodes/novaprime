import { readPage, type PageReadRoute } from "./page-read.js";

const myDayReadRoutes = new Map<string, PageReadRoute>([
  ["/api/attendance/today", { name: "attendance", query: [] }],
  ["/api/attendance/action-context", { name: "attendance-action-context", query: [] }],
  ["/api/work/assignments/mine", { name: "assignments", query: ["limit", "status"] }],
  ["/api/work/timeline", { name: "timeline", query: ["date"] }],
  ["/api/leave/mine", { name: "leave", query: [] }],
  ["/api/availability/wfh/mine", { name: "wfh", query: [] }],
]);

const myDayPageReadOptions = {
  routes: myDayReadRoutes,
  maxReads: 5,
  timingPrefix: "nova-my-day",
  failureEvent: "MY_DAY_PAGE_READ_FAILED",
  invalidPlanError: "INVALID_MY_DAY_READ_PLAN",
  includeTimelinePhases: true,
} as const;

type DispatchRead = (request: Request) => Promise<Response>;

/** Batch only My Day's visible, authorized, read-only projections. */
export function readMyDayPage(request: Request, dispatchRead: DispatchRead): Promise<Response> {
  return readPage(request, dispatchRead, myDayPageReadOptions);
}
