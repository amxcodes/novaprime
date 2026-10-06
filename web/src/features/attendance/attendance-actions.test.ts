import { describe, expect, it } from "bun:test";
import { getAttendanceActions, isAttendanceActionDisabled } from "./attendance-actions";
import type { AttendanceActionCapabilities, AttendanceProjection } from "./contracts";

const availability = {
  attendanceMode: "hour_based" as const,
  requiredAttendanceMinutes: 480,
  businessDate: "2026-10-02",
  calendarId: "calendar-1",
  isHoliday: false,
  isWorkingDay: true,
  officeId: "office-1",
  officeName: "Central office",
  shiftId: null,
  timezone: "Asia/Kolkata",
  wfhAllowed: true,
};

const actionContext = (overrides: Partial<AttendanceProjection> = {}): AttendanceProjection => ({
  actionContext: true,
  availability: {
    attendanceMode: "hour_based",
    businessDate: availability.businessDate,
    calendarId: availability.calendarId,
    isHoliday: availability.isHoliday,
    isWorkingDay: availability.isWorkingDay,
    officeName: availability.officeName,
    shiftId: availability.shiftId,
    timezone: availability.timezone,
    wfhAllowed: availability.wfhAllowed,
  },
  onApprovedLeave: false,
  wfhApproved: false,
  wfhPending: false,
  provisionalAttendance: null,
  attendance: null,
  ...overrides,
} as AttendanceProjection);

const capabilities = (overrides: Partial<AttendanceActionCapabilities> = {}): AttendanceActionCapabilities => ({
  checkIn: false,
  checkOut: false,
  changeMode: false,
  ...overrides,
});

describe("attendance action presentation", () => {
  it("requires parent-derived action capabilities even when the date is eligible", () => {
    expect(getAttendanceActions(actionContext(), capabilities())).toEqual([]);
    expect(getAttendanceActions(actionContext(), capabilities({ checkIn: true }))).toEqual(["check-in-office"]);
  });

  it("shows WFH check-in only when allowed and approved or pending", () => {
    const canCheckIn = capabilities({ checkIn: true });
    expect(getAttendanceActions(actionContext(), canCheckIn)).toEqual(["check-in-office"]);
    expect(getAttendanceActions(actionContext({ wfhApproved: true }), canCheckIn)).toEqual([
      "check-in-office", "check-in-wfh",
    ]);
    const pendingWfh = actionContext({ wfhPending: true });
    expect(getAttendanceActions(pendingWfh, canCheckIn)).toEqual(["check-in-office", "check-in-wfh"]);
    expect(isAttendanceActionDisabled("check-in-office", pendingWfh, false)).toBe(true);
    expect(isAttendanceActionDisabled("check-in-wfh", pendingWfh, false)).toBe(false);
  });

  it("does not offer new check-in on a holiday, non-working date, missing calendar, shift, or approved leave", () => {
    const canCheckIn = capabilities({ checkIn: true });
    expect(getAttendanceActions(actionContext({ availability: { ...availability, isHoliday: true } }), canCheckIn)).toEqual([]);
    expect(getAttendanceActions(actionContext({ availability: { ...availability, isWorkingDay: false } }), canCheckIn)).toEqual([]);
    expect(getAttendanceActions(actionContext({ availability: { ...availability, calendarId: null } }), canCheckIn)).toEqual([]);
    expect(getAttendanceActions(actionContext({ availability: { ...availability, attendanceMode: "scheduled", shiftId: null } }), canCheckIn)).toEqual([]);
    expect(getAttendanceActions(actionContext({ onApprovedLeave: true }), canCheckIn)).toEqual([]);
  });

  it("limits a pending provisional WFH interval to its permitted check-out", () => {
    const pending = actionContext({
      provisionalAttendance: { status: "pending", checkedInAt: "2026-10-02T03:45:00.000Z", checkedOutAt: null },
    });
    expect(getAttendanceActions(pending, capabilities({ checkIn: true }))).toEqual([]);
    expect(getAttendanceActions(pending, capabilities({ checkOut: true }))).toEqual(["check-out"]);
    const closedPending = actionContext({
      provisionalAttendance: { status: "pending", checkedInAt: "2026-10-02T03:45:00.000Z", checkedOutAt: "2026-10-02T11:00:00.000Z" },
    });
    expect(getAttendanceActions(closedPending, capabilities({ checkIn: true, checkOut: true }))).toEqual([]);
  });

  it("gates mode changes and check-out independently for an open record", () => {
    const openOffice = actionContext({
      attendance: { mode: "office", checkedInAt: "2026-10-02T03:30:00.000Z", checkedOutAt: null },
      wfhApproved: true,
    });
    expect(getAttendanceActions(openOffice, capabilities({ changeMode: true }))).toEqual(["change-to-wfh"]);
    expect(getAttendanceActions(openOffice, capabilities({ checkOut: true, changeMode: true }))).toEqual([
      "check-out", "change-to-wfh",
    ]);

    const openWfh = actionContext({ attendance: { mode: "wfh", checkedInAt: "2026-10-02T03:30:00.000Z", checkedOutAt: null } });
    expect(getAttendanceActions(openWfh, capabilities({ changeMode: true }))).toEqual(["change-to-office"]);
    expect(getAttendanceActions({ ...openWfh, onApprovedLeave: true }, capabilities({ changeMode: true }))).toEqual([]);
  });

  it("does not offer another command after checkout", () => {
    const closed = actionContext({
      attendance: { mode: "office", checkedInAt: "2026-10-02T03:30:00.000Z", checkedOutAt: "2026-10-02T11:30:00.000Z" },
    });
    expect(getAttendanceActions(closed, capabilities({ checkIn: true, checkOut: true, changeMode: true }))).toEqual([]);
  });
});
