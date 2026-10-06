import { expect, test } from "bun:test";
import { canCancelLeaveRequest, canResolveLeaveAttendanceConflict, leaveRequestInput } from "./leave";

test("leave cancellation hint matches current status, business date, and attendance rules", () => {
  for (const status of ["pending", "requested", "approved"]) {
    expect(canCancelLeaveRequest(status, "2026-09-21", "2026-09-21", false)).toBe(true);
  }
  for (const status of ["rejected", "cancelled", "completed"]) {
    expect(canCancelLeaveRequest(status, "2026-09-21", "2026-09-21", false)).toBe(false);
  }
  expect(canCancelLeaveRequest("approved", "2026-09-20", "2026-09-21", false)).toBe(false);
  expect(canCancelLeaveRequest("approved", "2026-09-21", "2026-09-21", true)).toBe(false);
});

test("leave conflict resolution hint requires the conflict, review, and recovery capabilities", () => {
  expect(canResolveLeaveAttendanceConflict(true, true, true)).toBe(true);
  expect(canResolveLeaveAttendanceConflict(true, true, false)).toBe(false);
  expect(canResolveLeaveAttendanceConflict(true, false, true)).toBe(false);
  expect(canResolveLeaveAttendanceConflict(false, true, true)).toBe(false);
});

test("accepts full and half-day leave portions within the requested range", () => {
  expect(leaveRequestInput({
    leaveType: "annual",
    startDate: "2026-09-21",
    endDate: "2026-09-23",
    reason: "Personal time",
    days: [
      { date: "2026-09-21", portion: 1 },
      { date: "2026-09-22", portion: 0.5 },
      { date: "2026-09-23", portion: 1 },
    ],
  })).toEqual({
    leaveType: "annual",
    startDate: "2026-09-21",
    endDate: "2026-09-23",
    reason: "Personal time",
    days: [
      { date: "2026-09-21", portion: 1 },
      { date: "2026-09-22", portion: 0.5 },
      { date: "2026-09-23", portion: 1 },
    ],
  });
});

test("rejects invalid dates, portions, duplicate days, and empty ranges", () => {
  expect(leaveRequestInput({
    leaveType: "annual", startDate: "2026-09-23", endDate: "2026-09-21",
    days: [{ date: "2026-09-22", portion: 1 }],
  })).toBeUndefined();
  expect(leaveRequestInput({
    leaveType: "annual", startDate: "2026-09-21", endDate: "2026-09-21",
    days: [{ date: "2026-09-21", portion: 0.25 }],
  })).toBeUndefined();
  expect(leaveRequestInput({
    leaveType: "annual", startDate: "2026-09-21", endDate: "2026-09-22",
    days: [{ date: "2026-09-21", portion: 1 }, { date: "2026-09-21", portion: 1 }],
  })).toBeUndefined();
});
