const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const routeModule = import("./work-timeline-route.js");
const permissionModule = import("../src/app-shell/permission-grants.ts");

const timeline = {
  date: "2026-10-02",
  personId: "private-person-id",
  attendance: { id: "private-attendance-id", checked_in_at: "2026-10-02T03:30:00.000Z" },
  attendanceSummary: { durationMinutes: 495, requiredMinutes: 480, requirementSatisfied: true, privateMeta: "omit" },
  attendancePolicy: {
    mode: "hour_based",
    timezone: "Asia/Kolkata",
    scheduledStart: null,
    scheduledEnd: null,
    graceMinutes: 10,
    shiftId: "private-shift-id",
    isHoliday: false,
  },
  sessions: [{ id: "private-session-id", title: "Do not project the raw session." }],
  adjustments: [{ id: "private-adjustment-id", reason: "Private correction reason." }],
  events: [
    {
      type: "work.started",
      at: "2026-10-02T04:00:00.000Z",
      sourceId: "session-1",
      assignmentId: "private-assignment-id",
      taskId: "private-task-id",
      title: "Prepare report",
      privateMeta: "omit",
    },
    { type: "invalid.event", at: "not-a-time", title: "Discard malformed event." },
  ],
  exceptions: [
    {
      type: "work.untracked_gap",
      startedAt: "2026-10-02T04:00:00.000Z",
      endedAt: "2026-10-02T05:00:00.000Z",
      actionable: true,
      sourceId: "private-source-id",
    },
    {
      type: "work.outside_attendance",
      startedAt: "2026-10-02T05:00:00.000Z",
      endedAt: "2026-10-02T05:30:00.000Z",
      actionable: true,
    },
  ],
};

const attendance = {
  availability: {
    attendanceMode: "hour_based",
    businessDate: "2026-10-03",
    calendarId: "private-calendar-id",
    isHoliday: false,
    isWorkingDay: true,
    officeId: "private-office-id",
    officeName: "Pune office",
    shiftId: "private-shift-id",
    timezone: "Asia/Kolkata",
    wfhAllowed: true,
    privateMeta: "omit",
  },
  onApprovedLeave: false,
  wfhApproved: false,
  wfhPending: true,
  provisionalAttendance: {
    id: "private-provisional-id",
    status: "pending",
    checkedInAt: "2026-10-03T03:30:00.000Z",
    checkedOutAt: null,
    resolvedAt: null,
    resolutionReason: "Private reviewer note.",
    creditable: false,
  },
  attendanceSummary: { durationMinutes: 0, requiredMinutes: 480, requirementSatisfied: false },
  attendance: {
    id: "private-attendance-id",
    mode: "office",
    checkedInAt: "2026-10-03T03:25:00.000Z",
    checkedOutAt: null,
    modeChangedAt: null,
    closureReason: null,
  },
};

const assignments = {
  assignments: [
    { assignmentId: "assignment-1", title: "Prepare report", personId: "private-person-id", task: { id: "private-task-id" } },
    { id: "no-authorized-key", title: "Should not project without assignmentId." },
  ],
  readAt: "private-read-at",
};

test("role-hidden data is not projected even when raw results contain private rows", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const props = projectWorkTimelineProps({
    readPlan: { timeline: false, attendance: false, assignments: false },
    timelineResult: timeline,
    attendanceResult: attendance,
    assignmentsResult: assignments,
    onCorrectGap: () => assert.fail("hidden correction callback must not be included or called"),
  });

  assert.deepEqual(props, {
    timeline: { status: "not-requested" },
    attendanceToday: { status: "not-requested" },
    correctionAssignments: [],
  });
  assert.equal(JSON.stringify(props).includes("private-person-id"), false);
  assert.equal(JSON.stringify(props).includes("Pune office"), false);
  assert.equal(JSON.stringify(props).includes("Prepare report"), false);
});

test("attendance and timeline permissions remain independent", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const props = projectWorkTimelineProps({
    readPlan: { timeline: false, attendance: true, assignments: false },
    timelineResult: timeline,
    attendanceResult: attendance,
    assignmentsResult: assignments,
  });

  assert.equal(props.timeline.status, "not-requested");
  assert.equal(props.attendanceToday.status, "ready");
  assert.equal(props.attendanceToday.data.availability.businessDate, "2026-10-03");
  assert.equal(props.correctionAssignments.length, 0);
  assert.equal("onCorrectGap" in props, false);
  assert.equal(JSON.stringify(props).includes("private-person-id"), false);
});

test("timeline denial and attendance failure retain separate source states and retry handlers", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const retryTimeline = () => {};
  const retryAttendance = () => {};
  const timelineDenied = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: true },
    timelineResult: { ...timeline, readError: "PERMISSION_DENIED" },
    attendanceResult: attendance,
    onRetryTimeline: retryTimeline,
  });
  assert.deepEqual(timelineDenied.timeline, {
    status: "denied",
    message: "Your current access does not allow this timeline.",
  });
  assert.equal(timelineDenied.attendanceToday.status, "ready");

  const attendanceFailed = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: true },
    timelineResult: timeline,
    attendanceResult: { ...attendance, readError: "REQUEST_FAILED" },
    onRetryAttendance: retryAttendance,
  });
  assert.equal(attendanceFailed.timeline.status, "ready");
  assert.equal(attendanceFailed.attendanceToday.status, "error");
  assert.equal(attendanceFailed.attendanceToday.onRetry, retryAttendance);
  assert.match(attendanceFailed.attendanceToday.message, /attendance summary could not load/i);
});

test("each planned read maps its own permission denial or transport failure", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const timelineDenied = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: false },
    timelineResult: { readError: "PREREQUISITE_PERMISSION_REQUIRED" },
  });
  assert.equal(timelineDenied.timeline.status, "denied");
  assert.equal(timelineDenied.attendanceToday.status, "not-requested");

  const attendanceDenied = projectWorkTimelineProps({
    readPlan: { timeline: false, attendance: true },
    attendanceResult: { readError: "PERMISSION_DENIED" },
  });
  assert.equal(attendanceDenied.timeline.status, "not-requested");
  assert.equal(attendanceDenied.attendanceToday.status, "denied");

  const timelineError = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: false },
    timelineResult: { readError: "REQUEST_FAILED" },
  });
  assert.equal(timelineError.timeline.status, "error");
  assert.equal(timelineError.attendanceToday.status, "not-requested");
});

test("ready reads whitelist presentation fields and discard unrelated backend data", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const props = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: true, assignments: true },
    timelineResult: timeline,
    attendanceResult: attendance,
    assignmentsResult: assignments,
  });

  assert.equal(props.timeline.status, "ready");
  assert.deepEqual(props.timeline.data.events, [{
    type: "work.started",
    at: "2026-10-02T04:00:00.000Z",
    sourceId: "session-1",
    title: "Prepare report",
  }]);
  assert.deepEqual(props.timeline.data.exceptions, [
    {
      type: "work.untracked_gap",
      startedAt: "2026-10-02T04:00:00.000Z",
      endedAt: "2026-10-02T05:00:00.000Z",
      actionable: true,
    },
    {
      type: "work.outside_attendance",
      startedAt: "2026-10-02T05:00:00.000Z",
      endedAt: "2026-10-02T05:30:00.000Z",
    },
  ]);
  assert.deepEqual(props.correctionAssignments, [{ assignmentId: "assignment-1", title: "Prepare report" }]);
  assert.equal(props.attendanceToday.status, "ready");
  assert.equal(props.attendanceToday.data.attendance.mode, "office");
  assert.equal("id" in props.attendanceToday.data.attendance, false);
  assert.equal("resolutionReason" in props.attendanceToday.data.provisionalAttendance, false);
  assert.equal("officeId" in props.attendanceToday.data.availability, false);
  assert.equal(JSON.stringify(props).includes("private-person-id"), false);
  assert.equal(JSON.stringify(props).includes("private-task-id"), false);
  assert.equal(JSON.stringify(props).includes("private-adjustment-id"), false);
});

test("assignment failures or a false assignment read plan remove correction choices", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const callback = () => {};
  const deniedAssignments = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: false, assignments: true },
    timelineResult: timeline,
    assignmentsResult: { ...assignments, readError: "PERMISSION_DENIED" },
    onCorrectGap: callback,
  });
  assert.deepEqual(deniedAssignments.correctionAssignments, []);
  assert.equal("onCorrectGap" in deniedAssignments, false);

  const hiddenAssignments = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: false, assignments: false },
    timelineResult: timeline,
    assignmentsResult: assignments,
    onCorrectGap: callback,
  });
  assert.deepEqual(hiddenAssignments.correctionAssignments, []);
  assert.equal("onCorrectGap" in hiddenAssignments, false);
});

test("own-correction grants expose the callback while client-scoped grants keep the form hidden", async () => {
  const [{ projectWorkTimelineProps }, { hasAnyPermissionGrant }] = await Promise.all([routeModule, permissionModule]);
  const allowedScopes = ["organisation", "own_record", "office", "organisation_department"];
  const correctionAction = () => {};
  const actionForGrant = (grant) => hasAnyPermissionGrant(
    { actorPersonId: "person-1", grants: [grant] },
    ["work.timeline_adjust_own"],
    allowedScopes,
  ) ? correctionAction : undefined;
  const project = (grant) => projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: false, assignments: true },
    timelineResult: timeline,
    assignmentsResult: assignments,
    onCorrectGap: actionForGrant(grant),
  });

  const ownRecord = project({ permissionKey: "work.timeline_adjust_own", scope: "own_record" });
  assert.equal(typeof ownRecord.onCorrectGap, "function");

  const clientScoped = project({ permissionKey: "work.timeline_adjust_own", scope: "client", clientId: "client-1" });
  assert.equal("onCorrectGap" in clientScoped, false);
  assert.deepEqual(clientScoped.correctionAssignments, [{ assignmentId: "assignment-1", title: "Prepare report" }]);
});

test("the correction callback accepts only a projected actionable gap and projected assignment", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const calls = [];
  const props = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: false, assignments: true },
    timelineResult: timeline,
    assignmentsResult: assignments,
    onCorrectGap: (value) => calls.push(value),
  });

  assert.equal(typeof props.onCorrectGap, "function");
  await props.onCorrectGap({
    startedAt: "2026-10-02T04:00:00.000Z",
    endedAt: "2026-10-02T05:00:00.000Z",
    assignmentId: "assignment-1",
    reason: "  Missed the timer.  ",
    privateMeta: "must be discarded",
  });
  assert.deepEqual(calls, [{
    startedAt: "2026-10-02T04:00:00.000Z",
    endedAt: "2026-10-02T05:00:00.000Z",
    assignmentId: "assignment-1",
    reason: "Missed the timer.",
  }]);

  assert.throws(() => props.onCorrectGap({
    startedAt: "2026-10-02T05:00:00.000Z",
    endedAt: "2026-10-02T05:30:00.000Z",
    assignmentId: "assignment-1",
    reason: "Wrong exception type.",
  }), /NOT_IN_AUTHORIZED_PROJECTION/);
  assert.throws(() => props.onCorrectGap({
    startedAt: "2026-10-02T04:00:00.000Z",
    endedAt: "2026-10-02T05:00:00.000Z",
    assignmentId: "hidden-assignment",
    reason: "Wrong assignment.",
  }), /NOT_IN_AUTHORIZED_PROJECTION/);
  assert.equal(calls.length, 1);
});

test("malformed success DTOs become source-local errors instead of fabricated ready data", async () => {
  const { projectWorkTimelineProps } = await routeModule;
  const props = projectWorkTimelineProps({
    readPlan: { timeline: true, attendance: true, assignments: true },
    timelineResult: { ...timeline, date: "2026-02-31" },
    attendanceResult: { ...attendance, availability: { ...attendance.availability, businessDate: "missing" } },
    assignmentsResult: assignments,
  });
  assert.equal(props.timeline.status, "error");
  assert.equal(props.attendanceToday.status, "error");
  assert.deepEqual(props.correctionAssignments, [{ assignmentId: "assignment-1", title: "Prepare report" }]);
});

test("the host gates the timeline correction form by canonical grants and delegates its mutation action", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  assert.match(source, /import \{ createWorkTimelineCorrectionAction \} from "\.\/app\/work-timeline-actions-route\.ts"/);
  assert.match(source, /const timelineCorrectionScopes = \["organisation", "own_record", "office", "organisation_department"\]/);
  assert.match(source, /const canAdjustTimeline = \(\) => hasAnyPermissionGrant\([\s\S]*?\["work\.timeline_adjust_own"\],[\s\S]*?timelineCorrectionScopes/);
  assert.match(source, /onCorrectGap: canAdjustTimeline\(\) \? createWorkTimelineCorrectionAction\([\s\S]*?canAdjustTimeline,[\s\S]*?\) : undefined/);
  assert.doesNotMatch(source, /onCorrectGap: async \(correction\) =>/);

  const action = fs.readFileSync(path.join(__dirname, "work-timeline-actions-route.ts"), "utf8");
  assert.match(action, /const permitted = canAdjustTimeline\(\);[\s\S]*?const commandContext = captureCommandContext\(target\)/);
  assert.match(action, /api\("\/api\/work\/timeline-adjustments", requestOptions\("POST", correction\)\)/);
  assert.match(action, /recoverProtectedCommandFailure\(error, commandContext, "Your time-correction access changed/);
  assert.match(action, /if \(!isCurrentCommand\(commandContext\)\) throw adminCommandUiError\("The Work page changed before this correction completed\."\)/);
  assert.match(action, /setMessage\("Timeline gap corrected and audited\."\);[\s\S]*?refreshWork\(\)/);
});

test("the timeline correction UI scope gate stays aligned with the database permission contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const hostScopes = source.match(/const timelineCorrectionScopes = \[([^\]]+)\]/);
  assert.ok(hostScopes, "Work route must declare its visible correction scopes");
  const hostScopeKeys = Array.from(hostScopes[1].matchAll(/"([^"]+)"/g), ([, scope]) => scope);

  const migration = fs.readFileSync(
    path.join(__dirname, "../../database/migrations/0024_permission_scope_catalogue.sql"),
    "utf8",
  );
  const permissionContract = migration.match(/'work\.timeline_adjust_own',\s*ARRAY\[([\s\S]*?)\]::nova\.permission_scope\[\]/);
  assert.ok(permissionContract, "Database migration must declare timeline correction scopes");
  const databaseScopeKeys = Array.from(permissionContract[1].matchAll(/'([^']+)'/g), ([, scope]) => scope);

  assert.deepEqual(hostScopeKeys, databaseScopeKeys);
});
