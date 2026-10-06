const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { WorkTimeline, formatBusinessDate, formatBusinessTime } = require("./WorkTimeline.tsx");

const timelineData = {
  date: "2026-10-02",
  attendanceSummary: { durationMinutes: 495, requiredMinutes: 480, requirementSatisfied: true },
  attendancePolicy: {
    mode: "hour_based",
    timezone: "Asia/Kolkata",
    scheduledStart: null,
    scheduledEnd: null,
    isHoliday: false,
  },
  events: [
    { type: "work.ended", at: "2026-10-02T12:00:00.000Z", sourceId: "session-1", title: "Prepare delivery brief" },
    { type: "attendance.check_in", at: "2026-10-02T03:30:00.000Z", sourceId: "attendance-1", mode: "office" },
  ],
  exceptions: [],
};

const attendanceData = {
  availability: {
    attendanceMode: "hour_based",
    businessDate: "2026-10-03",
    isHoliday: false,
    isWorkingDay: true,
    officeName: "Pune office",
    timezone: "Asia/Kolkata",
  },
  onApprovedLeave: false,
  wfhPending: true,
  attendanceSummary: { durationMinutes: 0, requiredMinutes: 480, requirementSatisfied: false },
  attendance: null,
  provisionalAttendance: {
    status: "pending",
    checkedInAt: "2026-10-03T03:30:00.000Z",
    checkedOutAt: null,
    creditable: false,
  },
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(WorkTimeline, {
    timeline: { status: "ready", data: timelineData },
    attendanceToday: { status: "ready", data: attendanceData },
    correctionAssignments: [],
    ...overrides,
  }));
}

test("business dates remain date-only while instants use the supplied office timezone", () => {
  assert.match(formatBusinessDate("2026-10-02"), /(?:Oct 2|2 Oct), 2026/);
  assert.equal(formatBusinessDate("2026-02-31"), "Date unavailable");
  assert.ok(formatBusinessTime("2026-10-02T02:00:00.000Z", "Asia/Kolkata").includes("7:30"));
  assert.equal(formatBusinessTime("invalid", "Asia/Kolkata"), "Time unavailable");
});

test("renders a chronological selected-date timeline and keeps attendance-today on its own business date", () => {
  const html = render();
  assert.match(html, /Selected business date/);
  assert.match(html, /Fri, (?:Oct 2|2 Oct), 2026/);
  assert.match(html, /Office time zone/);
  assert.match(html, /Asia\/Kolkata/);
  assert.match(html, /Required attendance/);
  assert.match(html, /Attendance requirement met/);
  assert.ok(html.indexOf("Checked in") < html.indexOf("Work session ended"));
  assert.match(html, /Attendance today/);
  assert.match(html, /Separate current-day source/);
  assert.match(html, /Sat, (?:Oct 3|3 Oct), 2026/);
  assert.match(html, /pending approval and not credited as attendance/);
  assert.match(html, /WFH approval pending/);
});

test("scheduled policy does not claim an hour requirement or completion", () => {
  const data = {
    ...timelineData,
    attendanceSummary: { durationMinutes: 240, requiredMinutes: 480, requirementSatisfied: false },
    attendancePolicy: {
      ...timelineData.attendancePolicy,
      mode: "scheduled",
      scheduledStart: "2026-10-02T03:30:00.000Z",
      scheduledEnd: "2026-10-02T12:30:00.000Z",
    },
  };
  const html = render({ timeline: { status: "ready", data }, attendanceToday: { status: "not-requested" } });
  assert.match(html, /Attendance policy/);
  assert.match(html, /Schedule based/);
  assert.match(html, /Scheduled hours/);
  assert.doesNotMatch(html, /Required attendance/);
  assert.doesNotMatch(html, /Attendance requirement met/);
});

test("timeline and attendance failures remain source-specific and do not erase the other source", () => {
  const attendanceError = render({
    attendanceToday: { status: "error", message: "Attendance service unavailable.", onRetry() {} },
  });
  assert.match(attendanceError, /Attendance summary could not load/);
  assert.match(attendanceError, /Attendance service unavailable\./);
  assert.match(attendanceError, /Work session ended/);
  assert.match(attendanceError, /Retry attendance/);

  const timelineError = render({
    timeline: { status: "error", message: "Timeline service unavailable." },
  });
  assert.match(timelineError, /Timeline could not load/);
  assert.match(timelineError, /Timeline service unavailable\./);
  assert.match(timelineError, /Attendance today/);
  assert.match(timelineError, /Pune office/);

  const denied = render({ timeline: { status: "denied" } });
  assert.match(denied, /Timeline unavailable/);
  assert.doesNotMatch(denied, /Timeline service unavailable/);
});

test("an unrequested attendance projection is omitted instead of guessed from timeline data", () => {
  const html = render({ attendanceToday: { status: "not-requested" } });
  assert.doesNotMatch(html, /Attendance today/);
  assert.match(html, /Recorded attendance/);
  assert.match(html, /8h 15m/);
});

test("attendance remains available when the role was not granted the timeline", () => {
  const html = render({ timeline: { status: "not-requested" } });
  assert.match(html, /Attendance today/);
  assert.match(html, /Pune office/);
  assert.doesNotMatch(html, /Daily timeline|Recorded events/);

  assert.equal(render({
    timeline: { status: "not-requested" },
    attendanceToday: { status: "not-requested" },
  }), "");
});

test("only a server-marked untracked gap with host-projected assignments and callback gets a correction form", () => {
  const gap = { type: "work.untracked_gap", startedAt: "2026-10-02T04:00:00.000Z", endedAt: "2026-10-02T05:00:00.000Z", actionable: true };
  const assignment = { assignmentId: "assignment-1", title: "Prepare brief" };
  const onCorrectGap = async () => {};
  const ready = render({
    timeline: { status: "ready", data: { ...timelineData, exceptions: [gap] } },
    correctionAssignments: [assignment],
    onCorrectGap,
  });
  assert.match(ready, /Untracked work time/);
  assert.match(ready, /Correction available/);
  assert.match(ready, /Record missing work time/);
  assert.match(ready, /Reason/);
  assert.match(ready, /role="combobox"/);
  assert.match(ready, /type="hidden" name="assignmentId" value=""/);
  assert.doesNotMatch(ready, /<select\b/);

  const noCallback = render({ timeline: { status: "ready", data: { ...timelineData, exceptions: [gap] } }, correctionAssignments: [assignment] });
  assert.doesNotMatch(noCallback, /Record missing work time/);
  assert.doesNotMatch(noCallback, /Correction permission available|Correction available/);

  const noEligibleAssignment = render({
    timeline: { status: "ready", data: { ...timelineData, exceptions: [gap] } },
    correctionAssignments: [],
    onCorrectGap,
  });
  assert.doesNotMatch(noEligibleAssignment, /Record missing work time/);
  assert.doesNotMatch(noEligibleAssignment, /Correction permission available|Correction available/);

  const notActionable = render({
    timeline: { status: "ready", data: { ...timelineData, exceptions: [{ ...gap, actionable: false }] } },
    correctionAssignments: [assignment], onCorrectGap,
  });
  assert.doesNotMatch(notActionable, /Correction available|Record missing work time/);

  const wrongExceptionType = render({
    timeline: { status: "ready", data: { ...timelineData, exceptions: [{ ...gap, type: "work.outside_attendance" }] } },
    correctionAssignments: [assignment], onCorrectGap,
  });
  assert.doesNotMatch(wrongExceptionType, /Record missing work time/);
});

test("unknown event and exception keys stay generic; projection text is escaped and no ID-based links are fabricated", () => {
  const html = render({
    timeline: {
      status: "ready",
      data: {
        ...timelineData,
        events: [{ type: "work.started", at: "2026-10-02T04:00:00.000Z", title: "<script>alert(1)</script>" }],
        exceptions: [{ type: "unexpected.exception", startedAt: "2026-10-02T04:00:00.000Z", endedAt: "2026-10-02T05:00:00.000Z" }],
      },
    },
    attendanceToday: { status: "not-requested" },
  });
  assert.match(html, /Work session started/);
  assert.match(html, /Time exception/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<a\b/);
});

test("mobile styles use a narrow container layout without fixed-width overflow", () => {
  const css = fs.readFileSync(require.resolve("./WorkTimeline.module.css"), "utf8");
  const fieldCss = fs.readFileSync(require.resolve("../../../design-system/primitives/Field.module.css"), "utf8");
  assert.match(css, /@container work-timeline \(max-width: 24rem\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(fieldCss, /@media \(any-pointer: coarse\)[\s\S]*?min-height: var\(--nova-control-touch-target\)/);
  assert.doesNotMatch(css, /min-width:\s*\d{3,}px/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/);
});

test("forced colors pair timeline content with Canvas and CanvasText while keeping markers visible", () => {
  const css = fs.readFileSync(require.resolve("./WorkTimeline.module.css"), "utf8");
  const forcedColors = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(forcedColors, /\.timeline,\s*\.fact,\s*\.exception,\s*\.attendance\s*\{[^}]*border-color:\s*CanvasText;[^}]*color:\s*CanvasText;[^}]*background:\s*Canvas;/s);
  assert.match(forcedColors, /\.marker\s*\{[^}]*border-color:\s*Canvas;[^}]*outline-color:\s*CanvasText;[^}]*background:\s*Highlight;/s);
  assert.doesNotMatch(forcedColors, /background:\s*CanvasText/);
});
