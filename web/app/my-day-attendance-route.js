/**
 * Read the attendance projection consumed by My Day's AttendancePulse.
 *
 * The caller remains responsible for current-grant and workspace-visibility
 * planning, authenticated transport, and page identity/lifetime authority.
 * This adapter owns only endpoint selection and the read-state projection.
 */
export async function readMyDayAttendance({
  visible = false,
  readPlan = {},
  readApi,
  isCurrent = () => true,
  getReadIssue = () => undefined,
} = {}) {
  const canReadToday = readPlan?.attendance === true;
  const canReadActionContext = readPlan?.attendanceActionContext === true;
  if (!visible || (!canReadToday && !canReadActionContext)) return null;
  if (typeof readApi !== "function") throw new TypeError("readApi must be a function");
  if (!isCurrent()) return null;

  const resource = canReadToday
    ? "today’s attendance status"
    : "today’s attendance action context";
  const endpoint = canReadToday
    ? "/api/attendance/today"
    : "/api/attendance/action-context";

  let result;
  try {
    result = await readApi(endpoint);
  } catch (error) {
    result = { readError: error?.code || "REQUEST_FAILED" };
  }
  if (!isCurrent()) return null;

  const issue = getReadIssue(result, resource);
  if (result?.readError) {
    if (result.readError === "PERMISSION_DENIED") {
      return {
        status: "denied",
        message: issue?.message || "Attendance information is unavailable for this view.",
      };
    }
    return {
      status: "error",
      message: result.readError === "OFFICE_ASSIGNMENT_REQUIRED"
        ? "Attendance requires an active office assignment."
        : issue?.message || "Attendance information could not be loaded.",
    };
  }

  return result?.availability
    ? { status: "ready", data: result }
    : { status: "error", message: "Attendance information is unavailable for this business date." };
}
