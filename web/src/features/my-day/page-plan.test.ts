import { expect, test } from "bun:test";
import { planMyDayPage, type MyDayReadPlan, type MyDayWorkspacePlanPreferences } from "./page-plan";

const allReads: MyDayReadPlan = {
  attendance: true,
  attendanceActionContext: false,
  assignments: true,
  timeline: true,
  leaveRequest: true,
  wfhRequest: true,
};

const allModules: MyDayWorkspacePlanPreferences = {
  myDayModules: ["attendance", "assignments", "timeline", "leave", "wfh"],
  navigationOrder: ["today", "work", "people", "settings"],
};

test("preserves user module order and current module metadata", () => {
  const plan = planMyDayPage({
    workspace: { ...allModules, myDayModules: ["wfh", "timeline", "attendance", "leave", "assignments"] },
    readPlan: allReads,
    authorizedDestinations: [],
  });

  expect(plan.modules.map(({ id }) => id)).toEqual(["wfh", "timeline", "attendance", "leave", "assignments"]);
  expect(plan.moduleById.attendance).toEqual({
    id: "attendance",
    presentation: "card",
    title: "Attendance",
    description: "Your current office business date and attendance status.",
  });
  expect(plan.moduleById.assignments).toEqual({
    id: "assignments",
    presentation: "card",
    title: "My work",
    description: "A short view of assignments available to you.",
  });
  expect(plan.moduleById.timeline).toEqual({
    id: "timeline",
    presentation: "card",
    title: "Today’s timeline",
    description: "Attendance, productive sessions, and recorded time corrections for your business date.",
    wide: true,
  });
  expect(plan.moduleById.leave).toEqual({ id: "leave", presentation: "island" });
  expect(plan.moduleById.wfh).toEqual({ id: "wfh", presentation: "island" });
});

test("keeps grant/read-plan gates and personal visibility in force for mounts and reads", () => {
  const plan = planMyDayPage({
    workspace: allModules,
    readPlan: {
      ...allReads,
      attendance: false,
      attendanceActionContext: true,
      assignments: false,
      timeline: false,
      leaveRequest: false,
      wfhRequest: false,
    },
    authorizedDestinations: [],
  });

  expect(plan.modules.map(({ id }) => id)).toEqual(["attendance"]);
  expect(plan.moduleById.attendance?.description).toBe("Current-day context for the attendance actions your role can use.");
  expect(plan.mounts).toEqual({ attendance: true, assignments: false, timeline: false, leave: false, wfh: false });
  expect(plan.reads).toEqual({ attendance: true, assignments: false, timeline: false, leave: false, wfh: false });

  const denied = planMyDayPage({
    workspace: allModules,
    readPlan: {
      attendance: false,
      attendanceActionContext: false,
      assignments: false,
      timeline: false,
      leaveRequest: false,
      wfhRequest: false,
    },
    authorizedDestinations: [],
  });
  expect(denied.modules).toEqual([]);
  expect(denied.mounts).toEqual({ attendance: false, assignments: false, timeline: false, leave: false, wfh: false });
  expect(denied.reads).toEqual({ attendance: false, assignments: false, timeline: false, leave: false, wfh: false });

  const personalized = planMyDayPage({
    workspace: { ...allModules, myDayModules: ["attendance", "assignments", "timeline", "leave", "wfh"] },
    readPlan: { ...allReads, attendanceActionContext: false },
    authorizedDestinations: [],
  });
  expect(personalized.mounts).toEqual({ attendance: true, assignments: true, timeline: true, leave: true, wfh: true });
  const hidden = planMyDayPage({
    workspace: { ...allModules, myDayModules: ["assignments"] },
    readPlan: allReads,
    authorizedDestinations: [],
  });
  expect(hidden.modules.map(({ id }) => id)).toEqual(["assignments"]);
  expect(hidden.mounts).toEqual({ attendance: false, assignments: true, timeline: false, leave: false, wfh: false });
  expect(hidden.reads).toEqual({ attendance: false, assignments: true, timeline: false, leave: false, wfh: false });
});

test("uses authorized destinations only and preserves saved destination order", () => {
  const plan = planMyDayPage({
    workspace: { ...allModules, navigationOrder: ["today", "people", "work", "settings"] },
    readPlan: allReads,
    authorizedDestinations: [
      { view: "work", label: "Work", summary: "Tasks in scope." },
      { view: "today", label: "My Day", summary: "Current day." },
      { view: "people", label: "People", summary: "People in scope." },
    ],
  });

  expect(plan.destinations).toEqual([
    { id: "people", label: "People", summary: "People in scope." },
    { id: "work", label: "Work", summary: "Tasks in scope." },
  ]);
});
