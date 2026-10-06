import { describe, expect, it } from "bun:test";
import { mountMyDayPageRoute } from "./my-day-page-route.ts";
import type { MyDayPageProps } from "../src/features/my-day/contracts.ts";
import type { AttendancePulseProps } from "../src/features/attendance/attendance-pulse.tsx";
import type { WorkdayTimelineProps } from "../src/features/attendance/workday-timeline.tsx";
import type { AssignmentListProps } from "../src/features/assignments/contracts.ts";

type ModuleId = "attendance" | "assignments" | "timeline" | "leave" | "wfh";
type Target = Element & { isConnected: boolean; replaceChildren: (...children: unknown[]) => void; children: unknown[] };
type Mounted = { target: Element; component: unknown; props: Record<string, any> };

const MyDayPage = (_props: MyDayPageProps) => null;
const AttendancePulse = (_props: AttendancePulseProps) => null;
const WorkdayTimeline = (_props: WorkdayTimelineProps) => null;
const AssignmentList = (_props: AssignmentListProps) => null;
const target = (): Target => ({
  isConnected: true,
  children: [],
  replaceChildren(...children) { this.children = children; },
} as unknown as Target);

function harness(options: {
  modules?: ModuleId[];
  current?: boolean;
  loader?: () => Promise<unknown>;
  pageApi?: (path: string) => Promise<unknown>;
} = {}) {
  const modules = options.modules ?? ["attendance", "assignments", "timeline"];
  const pageRoot = target();
  const targets = Object.fromEntries(modules.map((id) => [id, target()])) as Partial<Record<ModuleId, Target>>;
  const mounted: Mounted[] = [];
  const reads: string[] = [];
  const commands: Array<{ path: string; options: RequestInit }> = [];
  const localErrors: string[] = [];
  let current = options.current ?? true;
  let loaderCalls = 0;
  let feedbackCalls = 0;
  let renderCalls = 0;
  const grants = [
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "attendance.check_in", scope: "own_record", selfApplicable: true },
    { permissionKey: "work.timeline.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "tasks.view", scope: "organisation" },
  ];
  const lifetime = { id: "my-day-page" };
  const routePromise = mountMyDayPageRoute({
    actorGrants: { actorPersonId: "person-1", grants },
    getActorGrants: () => ({ actorPersonId: "person-1", grants }),
    workspace: { myDayModules: modules, navigationOrder: ["work"] },
    lifetime,
    pageRoot,
    findModuleTarget: (id) => targets[id] ?? null,
    MyDayPage,
    requestRoute: {
      renderLeaveRequestPanel: () => {},
      renderWfhRequestPanel: () => {},
    },
    isCurrentPageRequest: (value) => current && value === lifetime,
    mountReactIsland: (mountTarget, component, props) => mounted.push({
      target: mountTarget,
      component,
      props: props as Record<string, any>,
    }),
    pageApi: async (path) => {
      reads.push(path);
      if (options.pageApi) return options.pageApi(path);
      if (path === "/api/attendance/today") return { availability: { businessDate: "2026-10-05" }, attendance: null };
      if (path === "/api/work/timeline") return {
        date: "2026-10-05", events: [], exceptions: [],
        attendanceSummary: { durationMinutes: 0, requiredMinutes: 480, requirementSatisfied: false },
        attendancePolicy: null,
      };
      if (path === "/api/work/assignments/mine?limit=4&status=all") return { assignments: [], hasMore: false, limit: 4 };
      throw new Error(`Unexpected read: ${path}`);
    },
    api: async (path, requestOptions) => { commands.push({ path, options: requestOptions }); return {}; },
    requestOptions: (method, body) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) }),
    isCurrentCommand: () => true,
    runActionButton: (_source, action) => action({ id: "command-1" }),
    setMessage: () => {},
    render: () => { renderCalls += 1; },
    showFeedback: () => { feedbackCalls += 1; },
    go: () => {},
    noticeElement: (message) => { localErrors.push(message); return { message } as unknown as Element; },
    loadAttendanceFeatures: async () => {
      loaderCalls += 1;
      if (options.loader) return options.loader() as Promise<{ AttendancePulse: typeof AttendancePulse; WorkdayTimeline: typeof WorkdayTimeline }>;
      return { AttendancePulse, WorkdayTimeline };
    },
    loadAssignmentFeatures: async () => ({ AssignmentList }),
    loadAttendanceReadRoute: () => import("./my-day-attendance-route.js"),
    loadTimelineRoute: () => import("./my-day-timeline-route.js"),
  });

  return {
    routePromise, pageRoot, targets, mounted, reads, commands, localErrors, lifetime,
    setCurrent(value: boolean) { current = value; },
    get loaderCalls() { return loaderCalls; },
    get feedbackCalls() { return feedbackCalls; },
    get renderCalls() { return renderCalls; },
  };
}

describe("My Day page route", () => {
  it("does not load features or fetch data for modules hidden in saved workspace preferences", async () => {
    const state = harness({ modules: [] });
    await state.routePromise;

    expect(state.mounted.map(({ target: mountedTarget }) => mountedTarget)).toEqual([state.pageRoot]);
    expect(state.loaderCalls).toBe(0);
    expect(state.reads).toEqual([]);
    expect(state.feedbackCalls).toBe(1);
  });

  it("keeps feature-loader failures local to the planned slots", async () => {
    const state = harness({ loader: async () => { throw new Error("chunk unavailable"); } });
    await state.routePromise;

    expect(state.localErrors).toEqual(Array(3).fill("This My Day section could not load. Reload the page to try again."));
    expect(state.targets.attendance?.children).toHaveLength(1);
    expect(state.targets.assignments?.children).toHaveLength(1);
    expect(state.targets.timeline?.children).toHaveLength(1);
    expect(state.reads).toEqual([]);
    expect(state.mounted).toHaveLength(1);
  });

  it("preserves attendance, assignment, and timeline reads plus the existing attendance action", async () => {
    const state = harness();
    await state.routePromise;

    expect(state.reads).toEqual([
      "/api/attendance/today",
      "/api/work/assignments/mine?limit=4&status=all",
      "/api/work/timeline",
    ]);
    const attendance = state.mounted.filter(({ component }) => component === AttendancePulse).at(-1);
    expect(attendance?.props.read.status).toBe("ready");
    expect(attendance?.props.capabilities).toEqual({ checkIn: true, checkOut: false, changeMode: false });
    const assignments = state.mounted.filter(({ component }) => component === AssignmentList).at(-1);
    expect(assignments?.props.read).toMatchObject({ status: "ready", data: { limit: 4 } });
    const timeline = state.mounted.filter(({ component }) => component === WorkdayTimeline).at(-1);
    expect(timeline?.props.read.status).toBe("ready");
    expect(typeof timeline?.props.onOpenWork).toBe("function");

    await attendance?.props.onAction("check-in-wfh", {});
    expect(state.commands).toEqual([{
      path: "/api/attendance/check-in",
      options: { method: "POST", body: JSON.stringify({ mode: "wfh" }) },
    }]);
    expect(state.renderCalls).toBe(1);
  });

  it("suppresses feature mounts and reads after the page lifetime expires during loading", async () => {
    let finish!: (value: { AttendancePulse: typeof AttendancePulse; WorkdayTimeline: typeof WorkdayTimeline }) => void;
    const state = harness({ loader: () => new Promise((resolve) => { finish = resolve; }) });
    await Promise.resolve();
    state.setCurrent(false);
    finish({ AttendancePulse, WorkdayTimeline });
    await state.routePromise;

    expect(state.mounted).toHaveLength(1);
    expect(state.reads).toEqual([]);
  });
});
