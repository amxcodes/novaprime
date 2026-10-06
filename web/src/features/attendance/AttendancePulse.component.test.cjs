const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

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
const { AttendancePulse } = require("./attendance-pulse.tsx");
const stylesheet = fs.readFileSync(require.resolve("./attendance-pulse.module.css"), "utf8");

const projection = (overrides = {}) => ({
  availability: {
    attendanceMode: "hour_based",
    requiredAttendanceMinutes: 480,
    businessDate: "2026-10-05",
    calendarId: "calendar-1",
    isHoliday: false,
    isWorkingDay: true,
    officeId: "office-1",
    officeName: "Northline Studio",
    shiftId: null,
    timezone: "Asia/Kolkata",
    wfhAllowed: true,
  },
  onApprovedLeave: false,
  wfhApproved: true,
  wfhPending: false,
  provisionalAttendance: null,
  attendanceSummary: { durationMinutes: 0, requiredMinutes: 480, requirementSatisfied: false },
  attendance: null,
  ...overrides,
});

const renderAttendance = ({ data = projection(), capabilities = { checkIn: true, checkOut: false, changeMode: false }, ...props } = {}) =>
  renderToStaticMarkup(React.createElement(AttendancePulse, {
    read: { status: "ready", data },
    capabilities,
    onAction() {},
    ...props,
  }));

test("missing office assignment is presented as setup guidance, not a load failure", () => {
  const html = renderToStaticMarkup(React.createElement(AttendancePulse, {
    read: {
      status: "setup-required",
      message: "An active office assignment is required to use attendance.",
    },
    capabilities: { checkIn: false, checkOut: false, changeMode: false },
    onAction() {},
  }));

  assert.match(html, /Attendance setup needed/);
  assert.match(html, /An active office assignment is required to use attendance\./);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Attendance could not load|role="alert"/);
});

test("attendance check-in follows the Daily Workflows mode, location, action, and WFH composition", () => {
  const html = renderAttendance();

  assert.match(html, /Today’s attendance/);
  assert.match(html, /MON · OCT 05/);
  assert.match(html, /Choose check-in mode/);
  assert.match(html, /aria-pressed="true"[^>]*><span>Office<\/span>/);
  assert.match(html, /aria-pressed="false"[^>]*><span>Work from home<\/span>/);
  assert.match(html, /Office assigned/);
  assert.match(html, /Northline Studio/);
  assert.match(html, /Local time zone · Asia\/Kolkata/);
  assert.match(html, /Check in at Northline Studio/);
  assert.match(html, /Working from home today\?/);
  assert.match(html, /WFH request approved\./);
  assert.match(html, /Use WFH/);
  assert.match(html, /aria-label="Attendance actions"/);
});

test("WFH mode and alternate are omitted when the current projection offers only office check-in", () => {
  const data = projection({
    availability: { ...projection().availability, wfhAllowed: false },
    wfhApproved: false,
  });
  const html = renderAttendance({ data });

  assert.match(html, /Check in at Northline Studio/);
  assert.doesNotMatch(html, /Choose check-in mode|Work from home today\?|Use WFH|Check in from home/);
});

test("attendance actions remain absent when parent-provided capabilities deny check-in", () => {
  const html = renderAttendance({
    capabilities: { checkIn: false, checkOut: false, changeMode: false },
  });

  assert.doesNotMatch(html, /Choose check-in mode|aria-label="Attendance actions"|Use WFH/);
  assert.match(html, /Northline Studio/);
});

test("attendance composition uses semantic design tokens and collapses at tablet and phone widths", () => {
  const segmentedControlCss = fs.readFileSync(require.resolve("../../design-system/primitives/SegmentedControl.module.css"), "utf8");
  assert.match(stylesheet, /--nova-color-surface-subtle/);
  assert.match(stylesheet, /--nova-color-action-text/);
  assert.match(stylesheet, /--nova-radius-control/);
  assert.match(stylesheet, /@container \(max-width: 36rem\)/);
  assert.match(stylesheet, /@container \(max-width: 22rem\)/);
  assert.match(stylesheet, /@media \(forced-colors: active\)/);
  assert.match(segmentedControlCss, /\.group\[data-appearance="quiet"\]/);
  assert.match(segmentedControlCss, /--nova-color-control-selected-surface/);
  assert.match(segmentedControlCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(segmentedControlCss, /@media \(forced-colors: active\)/);
});
