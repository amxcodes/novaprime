import { mountReactIsland } from "../../src/app/react-islands.tsx";

function readErrorNotice(response, makeReadError) {
  if (typeof makeReadError !== "function") return null;
  const result = makeReadError(response);
  if (!result) return null;
  if (typeof result.message === "string" && (result.kind === "warning" || result.kind === "error")) {
    return { message: result.message, kind: result.kind };
  }

  // The legacy host shapes read failures as a styled DOM notice. Convert that
  // host-owned presentation into the small, serializable contract the feature uses.
  const message = typeof result.textContent === "string" ? result.textContent.trim() : "";
  if (!message) return null;
  const classes = String(result.className || "").split(/\s+/);
  return {
    message,
    kind: classes.includes("warning") ? "warning" : "error",
  };
}

/**
 * Mount the Operations correction queue. The host owns API transport, page
 * lifetime, permission checks, read-error wording, and command authorization.
 */
export async function renderAttendanceRecovery(target, lifetime, initialResult, {
  loadCandidates,
  isCurrentPageRequest,
  makeReadError,
  businessTimeLabel,
  onCorrect,
} = {}) {
  if (typeof loadCandidates !== "function" || typeof isCurrentPageRequest !== "function" ||
      typeof businessTimeLabel !== "function" || typeof onCorrect !== "function") {
    throw new TypeError("ATTENDANCE_RECOVERY_HOST_CONTRACT_INVALID");
  }

  if (!isCurrentPageRequest(lifetime)) return;
  const initialReadError = initialResult?.readError
    ? readErrorNotice(initialResult, makeReadError)
    : null;
  let AttendanceRecovery;
  try {
    ({ AttendanceRecovery } = await import("../../src/features/attendance/AttendanceRecovery.tsx"));
  } catch {
    if (!isCurrentPageRequest(lifetime)) return;
    const notice = target.ownerDocument.createElement("p");
    notice.className = "small";
    notice.setAttribute("role", "alert");
    notice.textContent = "Attendance recovery could not load. Refresh Operations to try again.";
    target.replaceChildren(notice);
    return;
  }
  if (!isCurrentPageRequest(lifetime)) return;

  mountReactIsland(target, AttendanceRecovery, {
    initialResult,
    initialReadError,
    loadCandidates: (cursor) => loadCandidates(cursor, lifetime),
    isCurrentPageRequest: () => isCurrentPageRequest(lifetime),
    makeReadError: (response) => readErrorNotice(response, makeReadError),
    businessTimeLabel,
    onCorrect,
  });
}
