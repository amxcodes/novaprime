import type { MyDayModule, MyDayModuleId, MyDayDestination } from "./contracts";

export interface MyDayWorkspacePlanPreferences {
  myDayModules: readonly MyDayModuleId[];
  navigationOrder: readonly string[];
}

/** Read eligibility already derived from the server's effective-grant read. */
export interface MyDayReadPlan {
  attendance: boolean;
  attendanceActionContext: boolean;
  assignments: boolean;
  timeline: boolean;
  leaveRequest: boolean;
  wfhRequest: boolean;
}

/** Destinations must be filtered by the host's current authorized destination resolver. */
export interface AuthorizedMyDayDestination {
  view: string;
  label: string;
  summary: string;
}

export interface MyDayPagePlan {
  /** Metadata lookup for route-owned child islands. */
  moduleById: Readonly<Record<MyDayModuleId, MyDayModule | null>>;
  /** Visible modules in the user's saved preference order. */
  modules: readonly MyDayModule[];
  /** These flags are the only modules the host may mount or read for this page. */
  mounts: Readonly<Record<MyDayModuleId, boolean>>;
  reads: Readonly<Record<MyDayModuleId, boolean>>;
  /** Authorized destinations, excluding My Day and in saved navigation order. */
  destinations: readonly MyDayDestination[];
}

/**
 * Plan the My Day composition from normalized user preferences and the current
 * grant/read hints. It contains no transport or authorization logic; callers
 * provide destinations only after the shared host resolver has authorized them.
 */
export function planMyDayPage({
  workspace,
  readPlan,
  authorizedDestinations,
}: {
  workspace: MyDayWorkspacePlanPreferences;
  readPlan: MyDayReadPlan;
  authorizedDestinations: readonly AuthorizedMyDayDestination[];
}): MyDayPagePlan {
  const enabledModules = new Set(workspace.myDayModules);
  const attendanceVisible = enabledModules.has("attendance") &&
    (readPlan.attendance || readPlan.attendanceActionContext);
  const moduleById: Record<MyDayModuleId, MyDayModule | null> = {
    attendance: attendanceVisible ? {
      id: "attendance",
      presentation: "card",
      title: "Attendance",
      description: readPlan.attendance
        ? "Your current office business date and attendance status."
        : "Current-day context for the attendance actions your role can use.",
    } : null,
    assignments: enabledModules.has("assignments") && readPlan.assignments ? {
      id: "assignments",
      presentation: "card",
      title: "My work",
      description: "A short view of assignments available to you.",
    } : null,
    timeline: enabledModules.has("timeline") && readPlan.timeline ? {
      id: "timeline",
      presentation: "card",
      title: "Today’s timeline",
      description: "Attendance, productive sessions, and recorded time corrections for your business date.",
      wide: true,
    } : null,
    leave: enabledModules.has("leave") && readPlan.leaveRequest
      ? { id: "leave", presentation: "island" } : null,
    wfh: enabledModules.has("wfh") && readPlan.wfhRequest
      ? { id: "wfh", presentation: "island" } : null,
  };

  const modules = workspace.myDayModules
    .map((id) => moduleById[id])
    .filter((module): module is MyDayModule => Boolean(module));
  const mounts = Object.fromEntries(
    (Object.keys(moduleById) as MyDayModuleId[]).map((id) => [id, moduleById[id] !== null]),
  ) as Record<MyDayModuleId, boolean>;
  // My Day's current child features read as part of mounting. Keeping this
  // explicit makes it harder for hidden modules to acquire route read work.
  const reads = { ...mounts };
  const destinations = authorizedDestinations
    .filter(({ view }) => view !== "today")
    .slice()
    .sort((left, right) => workspace.navigationOrder.indexOf(left.view) - workspace.navigationOrder.indexOf(right.view))
    .map(({ view, label, summary }) => ({ id: view, label, summary }));

  return { moduleById, modules, mounts, reads, destinations };
}
