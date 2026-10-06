import type { AttendanceAction, AttendanceActionCapabilities, AttendanceProjection } from "./contracts";

/**
 * Derive the presentation affordances from the current projection plus the
 * parent-owned effective-grant hints. The API remains authoritative on submit.
 */
export function getAttendanceActions(
  projection: AttendanceProjection,
  capabilities: AttendanceActionCapabilities,
): AttendanceAction[] {
  const { availability } = projection;
  const record = projection.attendance;
  const provisional = projection.provisionalAttendance;
  const actions: AttendanceAction[] = [];
  const attendanceOpen = Boolean(record && !record.checkedOutAt);

  if (attendanceOpen && capabilities.checkOut) actions.push("check-out");
  if (attendanceOpen && capabilities.changeMode && !projection.onApprovedLeave && record) {
    if (record.mode === "office" && availability.wfhAllowed && projection.wfhApproved) {
      actions.push("change-to-wfh");
    } else if (record.mode === "wfh") {
      actions.push("change-to-office");
    }
  }

  const provisionalPending = !record && provisional?.status === "pending";
  const provisionalOpen = provisionalPending && !provisional?.checkedOutAt;
  if (provisionalOpen && capabilities.checkOut) actions.push("check-out");

  const validWorkDate = availability.isWorkingDay && !availability.isHoliday &&
    Boolean(availability.calendarId) &&
    (availability.attendanceMode !== "scheduled" || Boolean(availability.shiftId)) &&
    !projection.onApprovedLeave;
  const canStart = !record && !provisionalPending && capabilities.checkIn && validWorkDate;
  if (canStart) {
    actions.push("check-in-office");
    if (availability.wfhAllowed && (projection.wfhApproved || projection.wfhPending)) {
      actions.push("check-in-wfh");
    }
  }

  return actions;
}

/** The office check-in is visible but unavailable while a WFH request is pending. */
export function isAttendanceActionDisabled(
  action: AttendanceAction,
  projection: AttendanceProjection,
  hasPendingCommand: boolean,
): boolean {
  return hasPendingCommand || (action === "check-in-office" && projection.wfhPending);
}
