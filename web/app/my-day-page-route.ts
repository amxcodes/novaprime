import type { ComponentType } from "react";
import { createMyDayAttendanceActionRoute } from "./my-day-attendance-actions-route.ts";
import { adminReadIssue, planMyDayReads, planTodayFeatures, readOrError } from "../admin-read-state.js";
import { canAccessWorkspaceDestination } from "../workspace-destinations.js";
import { planMyDayPage } from "../src/features/my-day/page-plan.ts";
import type { MyDayPageProps } from "../src/features/my-day/contracts.ts";
import type {
  AttendanceAction,
  FeatureReadState,
  WorkdayTimelineProjection,
} from "../src/features/attendance/contracts.ts";
import type { AttendancePulseProps } from "../src/features/attendance/attendance-pulse.tsx";
import type { WorkdayTimelineProps } from "../src/features/attendance/workday-timeline.tsx";
import type { AssignmentListProps } from "../src/features/assignments/contracts.ts";
import type { mountReactIsland } from "../src/app/react-islands.tsx";

type Lifetime = unknown;
type WorkspacePreferences = Parameters<typeof planMyDayPage>[0]["workspace"];
type ReadPlan = ReturnType<typeof planMyDayReads>;
type ReadIssue = { message?: string } | undefined;
type MyDayRead = { path: string; status: number; body: unknown };
type PageReadOptions = { method: "POST"; body: unknown; readOnly: true };
type PageApi = (path: string, lifetime: Lifetime, options?: PageReadOptions) => Promise<any>;
type MyDayPageApi = (path: string, lifetime?: Lifetime) => Promise<any>;

interface MyDayReadServices {
  visible: boolean;
  readPlan: ReadPlan;
  readApi: (path: string) => Promise<unknown>;
  isCurrent: () => boolean;
  getReadIssue: (result: unknown, resource: string) => ReadIssue;
}

type AttendanceReadRoute = (services: MyDayReadServices) => Promise<AttendancePulseProps["read"] | null>;
type TimelineRouteFactory = (services: MyDayReadServices & {
  onChange: (read: FeatureReadState<WorkdayTimelineProjection>) => void;
}) => { load: () => Promise<boolean> };

interface HostServices {
  actorGrants: Parameters<typeof planMyDayReads>[0];
  getActorGrants: () => Parameters<typeof planMyDayReads>[0];
  workspace: WorkspacePreferences;
  lifetime: Lifetime;
  pageRoot: Element | null;
  findModuleTarget: (id: "attendance" | "assignments" | "timeline" | "leave" | "wfh") => Element | null;
  MyDayPage: ComponentType<MyDayPageProps>;
  requestRoute: {
    renderLeaveRequestPanel: (target: Element | null, readApi?: MyDayPageApi) => void;
    renderWfhRequestPanel: (target: Element | null, readApi?: MyDayPageApi) => void;
  };
  isCurrentPageRequest: (lifetime: Lifetime) => boolean;
  mountReactIsland: typeof mountReactIsland;
  pageApi: PageApi;
  api: (path: string, options: RequestInit) => Promise<unknown>;
  requestOptions: (method: string, body?: unknown) => RequestInit;
  isCurrentCommand: (context: unknown) => boolean;
  runActionButton: <T>(source: Element, action: (context: unknown) => Promise<T>) => Promise<T>;
  setMessage: (message: string) => void;
  render: () => void;
  showFeedback: () => void;
  go: (view: string) => void;
  noticeElement: (message: string, kind: "error") => Element;
  loadAttendanceFeatures?: () => Promise<{
    AttendancePulse: ComponentType<AttendancePulseProps>;
    WorkdayTimeline: ComponentType<WorkdayTimelineProps>;
  }>;
  loadAssignmentFeatures?: () => Promise<{ AssignmentList: ComponentType<AssignmentListProps> }>;
  loadAttendanceReadRoute?: () => Promise<typeof import("./my-day-attendance-route.js")>;
  loadTimelineRoute?: () => Promise<typeof import("./my-day-timeline-route.js")>;
}

/**
 * Compose My Day from the current effective-grant plan and saved workspace
 * preferences. The host supplies authenticated transport and page/command
 * lifetime checks; this adapter owns the feature mounts and reads.
 */
export async function mountMyDayPageRoute(services: HostServices): Promise<void> {
  const {
    actorGrants, getActorGrants, workspace, lifetime, pageRoot, findModuleTarget,
    MyDayPage, requestRoute, isCurrentPageRequest, mountReactIsland, pageApi, api,
    requestOptions, isCurrentCommand, runActionButton, setMessage, render,
    showFeedback, go, noticeElement,
  } = services;
  const readPlan: ReadPlan = planMyDayReads(actorGrants);
  const todayFeatures = planTodayFeatures(actorGrants);
  const myDayPlan = planMyDayPage({
    workspace,
    readPlan,
  });

  if (!isCurrentPageRequest(lifetime) || !pageRoot) return;
  mountReactIsland(pageRoot, MyDayPage, {
    modules: myDayPlan.modules,
    onCustomize: () => go("settings"),
  });
  showFeedback();

  const moduleTarget = (id: "attendance" | "assignments" | "timeline" | "leave" | "wfh") => findModuleTarget(id);
  const plannedModuleTarget = (id: "attendance" | "assignments" | "timeline" | "leave" | "wfh") =>
    myDayPlan.mounts[id] && myDayPlan.reads[id] ? moduleTarget(id) : null;
  const attendanceTarget = plannedModuleTarget("attendance");
  const assignmentsTarget = plannedModuleTarget("assignments");
  const timelineTarget = plannedModuleTarget("timeline");
  const leaveTarget = plannedModuleTarget("leave");
  const wfhTarget = plannedModuleTarget("wfh");

  const attendanceReadPath = attendanceTarget
    ? readPlan.attendance
      ? "/api/attendance/today"
      : readPlan.attendanceActionContext ? "/api/attendance/action-context" : null
    : null;
  const assignmentReadPath = assignmentsTarget ? "/api/work/assignments/mine?limit=4&status=all" : null;
  const leaveReadPath = leaveTarget ? "/api/leave/mine" : null;
  const wfhReadPath = wfhTarget ? "/api/availability/wfh/mine" : null;
  // Keep the timeline as an independent read so a slow projection cannot hold
  // attendance and assignment cards in their loading state. The two compact
  // groups each share one auth/session lookup without coupling core and request
  // panels to each other's data latency.
  const readGroups = [
    [attendanceReadPath, assignmentReadPath],
    [leaveReadPath, wfhReadPath],
  ].map((group) => group.filter((path): path is string => path !== null));
  const consumedBatchReads = new Set<string>();
  const batchReadsByPath = new Map<string, Promise<Map<string, MyDayRead>>>();
  for (const paths of readGroups) {
    if (paths.length < 2) continue;
    const batch = pageApi("/api/my-day/page-read", lifetime, {
      method: "POST",
      body: { reads: paths },
      readOnly: true,
    }).then((result) => {
      if (!Array.isArray(result?.reads) || result.reads.length !== paths.length) {
        throw Object.assign(new Error("Invalid My Day page read response"), { code: "REQUEST_FAILED" });
      }
      const reads = result.reads as MyDayRead[];
      if (reads.some((read) => !read || typeof read.path !== "string" || !Number.isInteger(read.status))) {
        throw Object.assign(new Error("Invalid My Day page read response"), { code: "REQUEST_FAILED" });
      }
      const resultByPath = new Map(reads.map((read) => [read.path, read]));
      if (paths.some((path) => !resultByPath.has(path))) {
        throw Object.assign(new Error("Incomplete My Day page read response"), { code: "REQUEST_FAILED" });
      }
      return resultByPath;
    });
    paths.forEach((path) => batchReadsByPath.set(path, batch));
  }
  const pageReadApi: MyDayPageApi = (path, requestLifetime = lifetime) => {
    const batchReads = batchReadsByPath.get(path);
    if (!batchReads || consumedBatchReads.has(path)) {
      return pageApi(path, requestLifetime);
    }
    consumedBatchReads.add(path);
    return batchReads.then((reads) => {
      const read = reads.get(path);
      if (!read) throw Object.assign(new Error("Missing My Day page read"), { code: "REQUEST_FAILED" });
      if (read.status >= 200 && read.status < 300) return read.body;
      const errorCode = read.body && typeof read.body === "object" && "error" in read.body
        ? String(read.body.error)
        : "REQUEST_FAILED";
      const error = Object.assign(new Error(errorCode), { code: errorCode, httpStatus: read.status });
      throw error;
    });
  };

  if (leaveTarget) requestRoute.renderLeaveRequestPanel(leaveTarget, pageReadApi);
  if (wfhTarget) requestRoute.renderWfhRequestPanel(wfhTarget, pageReadApi);

  const attendanceCapabilities = {
    checkIn: todayFeatures.checkIn === true,
    checkOut: todayFeatures.checkOut === true,
    changeMode: todayFeatures.changeMode === true,
  };
  let attendanceComponents: Awaited<ReturnType<NonNullable<HostServices["loadAttendanceFeatures"]>>> | null = null;
  let assignmentComponents: Awaited<ReturnType<NonNullable<HostServices["loadAssignmentFeatures"]>>> | null = null;
  let pendingTimelineRead: WorkdayTimelineProps["read"] | null = null;

  const mountTimeline = (read: WorkdayTimelineProps["read"]) => {
    if (!timelineTarget || !isCurrentPageRequest(lifetime) || !timelineTarget.isConnected) return;
    // The timeline request now runs alongside the component chunk download. If
    // its response wins that race, retain the projection until the component
    // is ready so the route still mounts only into the current page lifetime.
    if (!attendanceComponents) {
      pendingTimelineRead = read;
      return;
    }
    mountReactIsland(timelineTarget, attendanceComponents.WorkdayTimeline, {
      read,
      ...(canAccessWorkspaceDestination("work", getActorGrants()) ? { onOpenWork: () => go("work") } : {}),
    });
  };

  const attendanceComponentsPromise = attendanceTarget || timelineTarget
    ? (services.loadAttendanceFeatures ?? (() => import("../src/features/attendance/index.js")))()
    : Promise.resolve(null);
  const assignmentComponentsPromise = assignmentsTarget
    ? (services.loadAssignmentFeatures ?? (() => import("../src/features/assignments/index.js")))()
    : Promise.resolve(null);
  const attendanceRoutePromise = attendanceTarget
    ? (services.loadAttendanceReadRoute ?? (() => import("./my-day-attendance-route.js")))()
    : Promise.resolve(null);
  const timelineRoutePromise = timelineTarget
    ? (services.loadTimelineRoute ?? (() => import("./my-day-timeline-route.js")))()
    : Promise.resolve(null);

  // Start independent authorized reads as soon as their small route adapters
  // are available instead of waiting for all feature UI chunks to finish.
  const attendancePromise = attendanceRoutePromise.then((attendanceRouteUi) =>
    myDayPlan.reads.attendance && attendanceTarget && attendanceRouteUi
      ? (attendanceRouteUi.readMyDayAttendance as unknown as AttendanceReadRoute)({
        visible: myDayPlan.reads.attendance,
        readPlan,
        readApi: (path: string) => pageReadApi(path, lifetime),
        isCurrent: () => isCurrentPageRequest(lifetime),
        getReadIssue: adminReadIssue,
      })
      : null,
  );
  const assignmentPromise = myDayPlan.reads.assignments && assignmentsTarget
    ? readOrError(pageReadApi("/api/work/assignments/mine?limit=4&status=all", lifetime), { assignments: [], hasMore: false })
    : Promise.resolve(undefined);
  void attendancePromise.catch(() => undefined);
  void assignmentPromise.catch(() => undefined);
  const timelinePromise = timelineRoutePromise.then((timelineRouteUi) => {
    if (!timelineRouteUi || !timelineTarget) return undefined;
    const route = (timelineRouteUi.createMyDayTimelineRoute as unknown as TimelineRouteFactory)({
      visible: myDayPlan.reads.timeline,
      readPlan,
      readApi: (path: string) => readOrError(pageReadApi(path, lifetime), { events: [], exceptions: [] }),
      isCurrent: () => isCurrentPageRequest(lifetime) && timelineTarget.isConnected,
      getReadIssue: adminReadIssue,
      onChange: mountTimeline,
    });
    return route.load();
  });
  // Attach a rejection observer immediately; the route bundle and the feature
  // bundle are separate asynchronous loads and either one may fail first.
  void timelinePromise.catch(() => undefined);
  const canPublish = (target: Element | null): target is Element =>
    Boolean(target && target.isConnected && isCurrentPageRequest(lifetime));
  const showSlotError = (target: Element | null) => {
    if (canPublish(target)) {
      target.replaceChildren(noticeElement("This My Day section could not load. Reload the page to try again.", "error"));
    }
  };

  // Feature bundles, the primary read batch, and the standalone timeline read
  // settle independently so a slow timeline cannot block attendance or work.
  const mountAttendanceFeature = async () => {
    try {
      attendanceComponents = await attendanceComponentsPromise;
      if (!attendanceComponents || !isCurrentPageRequest(lifetime)) return;
      if (attendanceTarget && canPublish(attendanceTarget)) {
        mountReactIsland(attendanceTarget, attendanceComponents.AttendancePulse, {
          read: { status: "loading" }, capabilities: attendanceCapabilities, onAction: () => {},
        });
      }
      if (timelineTarget && canPublish(timelineTarget)) {
        mountReactIsland(timelineTarget, attendanceComponents.WorkdayTimeline, { read: { status: "loading" } });
      }
      if (pendingTimelineRead) {
        mountTimeline(pendingTimelineRead);
        pendingTimelineRead = null;
      }

      if (attendanceTarget) {
        void attendancePromise.then((attendanceRead) => {
          if (!canPublish(attendanceTarget)) return;
          const performAttendanceAction = createMyDayAttendanceActionRoute({
            isCurrentCommand,
            requestCommand: (path, body) => api(path, requestOptions("POST", body)),
            onSuccess: (action: AttendanceAction) => {
              setMessage(action === "check-out" ? "Attendance checked out." : "Attendance updated.");
              render();
            },
          });
          mountReactIsland(attendanceTarget, attendanceComponents.AttendancePulse, {
            // The page plan only mounts Attendance Pulse when one of its attendance
            // reads is authorized, so the adapter returns a state while this page is current.
            read: attendanceRead as AttendancePulseProps["read"],
            capabilities: attendanceCapabilities,
            onAction: (action: AttendanceAction, source: Element) =>
              runActionButton(source, (context) => performAttendanceAction(action, context)),
          });
        }).catch(() => {
          showSlotError(attendanceTarget);
        });
      }
      if (timelineTarget) {
        void timelinePromise.catch(() => {
          showSlotError(timelineTarget);
        });
      }
    } catch {
      showSlotError(attendanceTarget);
      showSlotError(timelineTarget);
    }
  };

  const mountAssignmentsFeature = async () => {
    if (!assignmentsTarget) return;
    try {
      assignmentComponents = await assignmentComponentsPromise;
      if (!assignmentComponents || !canPublish(assignmentsTarget)) return;
      mountReactIsland(assignmentsTarget, assignmentComponents.AssignmentList, { read: { status: "loading" } });
      void assignmentPromise.then((assignmentsResult) => {
        if (!canPublish(assignmentsTarget)) return;
        const issue = adminReadIssue(assignmentsResult, "your assignments");
        const read = assignmentsResult?.readError
          ? assignmentsResult.readError === "PERMISSION_DENIED"
            ? { status: "denied" as const, message: issue?.message || "Your current access does not allow this assignment list." }
            : { status: "error" as const, message: issue?.message || "Your assignments could not be loaded." }
          : Array.isArray(assignmentsResult?.assignments) && Number.isSafeInteger(assignmentsResult?.limit)
            ? { status: "ready" as const, data: assignmentsResult }
            : { status: "error" as const, message: "Your assignment list is unavailable right now." };
        mountReactIsland(assignmentsTarget, assignmentComponents!.AssignmentList, {
          read,
          ...(canAccessWorkspaceDestination("work", getActorGrants()) ? { onOpenWork: () => go("work") } : {}),
        });
      }).catch(() => showSlotError(assignmentsTarget));
    } catch {
      showSlotError(assignmentsTarget);
    }
  };

  await Promise.all([mountAttendanceFeature(), mountAssignmentsFeature()]);
}
