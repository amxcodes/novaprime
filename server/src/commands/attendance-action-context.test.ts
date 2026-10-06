import { expect, test } from "bun:test";
import { projectAttendanceActionContext } from "./attendance.js";

test("attendance action context exposes only the own-day fields needed to operate allowed actions", () => {
  const source = {
    availability: {
      attendanceMode: "scheduled" as const,
      requiredAttendanceMinutes: 480,
      businessDate: "2026-10-01",
      calendarId: "calendar-1",
      isHoliday: false,
      isWorkingDay: true,
      officeId: "office-1",
      officeLatitude: 10,
      officeLongitude: 20,
      geofenceRadiusMeters: 100,
      officeName: "Pune Office",
      shiftId: "shift-1",
      timezone: "Asia/Kolkata",
      wfhAllowed: true,
    },
    onApprovedLeave: false,
    wfhApproved: true,
    wfhPending: false,
    provisionalAttendance: {
      id: "provisional-1",
      status: "pending",
      checkedInAt: new Date("2026-10-01T03:30:00.000Z"),
      checkedOutAt: null,
      resolutionReason: null,
      creditable: false,
    },
    attendance: {
      id: "attendance-1",
      mode: "office" as const,
      checkedInAt: new Date("2026-10-01T03:00:00.000Z"),
      checkedOutAt: null,
      modeChangedAt: null,
      closureReason: null,
    },
    attendanceSummary: { durationMinutes: 90, requiredMinutes: 480, requirementSatisfied: false },
  };
  const result = projectAttendanceActionContext(source);

  expect(result).toEqual({
    actionContext: true,
    availability: {
      attendanceMode: "scheduled",
      businessDate: "2026-10-01",
      calendarId: "calendar-1",
      isHoliday: false,
      isWorkingDay: true,
      officeName: "Pune Office",
      shiftId: "shift-1",
      timezone: "Asia/Kolkata",
      wfhAllowed: true,
    },
    onApprovedLeave: false,
    wfhApproved: true,
    wfhPending: false,
    provisionalAttendance: {
      status: "pending",
      checkedInAt: new Date("2026-10-01T03:30:00.000Z"),
      checkedOutAt: null,
    },
    attendance: {
      mode: "office",
      checkedInAt: new Date("2026-10-01T03:00:00.000Z"),
      checkedOutAt: null,
    },
  });
});
