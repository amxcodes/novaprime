const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { readMyDayAttendance } = require("./my-day-attendance-route.js");

const readyProjection = { availability: { businessDate: "2026-10-03" }, attendance: null };

test("reads the full attendance projection only for the full-read plan", async () => {
  const calls = [];
  const read = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true, attendanceActionContext: true },
    readApi: async (url) => { calls.push(url); return readyProjection; },
  });

  assert.deepEqual(calls, ["/api/attendance/today"]);
  assert.deepEqual(read, { status: "ready", data: readyProjection });
});

test("uses the narrow action-context endpoint when that is the only planned read", async () => {
  const calls = [];
  const read = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: false, attendanceActionContext: true },
    readApi: async (url) => { calls.push(url); return readyProjection; },
  });

  assert.deepEqual(calls, ["/api/attendance/action-context"]);
  assert.deepEqual(read, { status: "ready", data: readyProjection });
});

test("does not fetch when the module is hidden or neither read is authorized", async () => {
  let calls = 0;
  const readApi = async () => { calls += 1; return readyProjection; };

  assert.equal(await readMyDayAttendance({
    visible: false,
    readPlan: { attendance: true },
    readApi,
  }), null);
  assert.equal(await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: false, attendanceActionContext: false },
    readApi,
  }), null);
  assert.equal(await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true },
    readApi,
    isCurrent: () => false,
  }), null);
  assert.equal(calls, 0);
});

test("maps permission denial to the existing denied state and message", async () => {
  const read = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true },
    readApi: async () => ({ readError: "PERMISSION_DENIED" }),
    getReadIssue: (_result, resource) => ({ message: `No access to ${resource}.` }),
  });

  assert.deepEqual(read, {
    status: "denied",
    message: "No access to today’s attendance status.",
  });
});

test("keeps the office-assignment message and general recoverable error mapping", async () => {
  const officeAssignment = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true },
    readApi: async () => ({ readError: "OFFICE_ASSIGNMENT_REQUIRED" }),
    getReadIssue: () => ({ message: "Mapped fallback" }),
  });
  const recoverable = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: false, attendanceActionContext: true },
    readApi: async () => ({ readError: "REQUEST_FAILED" }),
    getReadIssue: (_result, resource) => ({ message: `Could not load ${resource}.` }),
  });

  assert.deepEqual(officeAssignment, {
    status: "error",
    message: "Attendance requires an active office assignment.",
  });
  assert.deepEqual(recoverable, {
    status: "error",
    message: "Could not load today’s attendance action context.",
  });
});

test("uses the existing fallback for malformed or unavailable response data", async () => {
  const read = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true },
    readApi: async () => ({ attendance: null }),
  });

  assert.deepEqual(read, {
    status: "error",
    message: "Attendance information is unavailable for this business date.",
  });
});

test("converts thrown transport errors and never projects a stale read", async () => {
  const failed = await readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true },
    readApi: async () => { throw Object.assign(new Error("offline"), { code: "REQUEST_FAILED" }); },
    getReadIssue: () => ({ message: "Could not load attendance." }),
  });
  let current = true;
  const stale = readMyDayAttendance({
    visible: true,
    readPlan: { attendance: true },
    readApi: async () => { current = false; return readyProjection; },
    isCurrent: () => current,
  });

  assert.deepEqual(failed, { status: "error", message: "Could not load attendance." });
  assert.equal(await stale, null);
});

test("the My Day page adapter composes existing read and action adapters without changing transport contracts", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "my-day-page-route.ts"), "utf8");
  const actionRoute = fs.readFileSync(path.join(__dirname, "my-day-attendance-actions-route.ts"), "utf8");
  assert.match(app, /mountMyDayPageRoute\(\{/);
  assert.match(route, /readMyDayAttendance as unknown as AttendanceReadRoute\)\(\{[\s\S]*?readPlan,[\s\S]*?readApi:[\s\S]*?isCurrent:[\s\S]*?getReadIssue: adminReadIssue/);
  assert.match(route, /createMyDayAttendanceActionRoute\(\{[\s\S]*?requestCommand: \(path, body\) => api\(path, requestOptions\("POST", body\)\)/);
  assert.match(actionRoute, /"check-in-office": \{ path: "\/api\/attendance\/check-in", body: \{ mode: "office" \}, requiresOfficeLocation: true \}/);
  assert.match(actionRoute, /"check-in-wfh": \{ path: "\/api\/attendance\/check-in", body: \{ mode: "wfh" \} \}/);
  assert.match(actionRoute, /"check-out": \{ path: "\/api\/attendance\/check-out" \}/);
  assert.match(actionRoute, /"change-to-wfh": \{ path: "\/api\/attendance\/change-mode", body: \{ mode: "wfh" \} \}/);
  assert.match(actionRoute, /"change-to-office": \{ path: "\/api\/attendance\/change-mode", body: \{ mode: "office" \} \}/);
  assert.match(route, /readOrError\(pageApi\("\/api\/work\/assignments\/mine\?limit=4&status=all"/);
  assert.match(route, /readOrError\(pageApi\(path, lifetime\), \{ events: \[\], exceptions: \[\] \}\)/);
});
