import type {
  AttendanceRecoveryState,
  RecoveryCandidatesResponse,
  RecoveryReadErrorNotice,
} from "./recovery-contracts";

export function createAttendanceRecoveryState(
  initialResult?: RecoveryCandidatesResponse | null,
  initialReadError?: RecoveryReadErrorNotice | null,
): AttendanceRecoveryState {
  if (initialResult == null) {
    return {
      status: "loading",
      candidates: [],
      nextCursor: null,
      shownCount: 0,
      loadingMore: false,
      pageFailure: null,
    };
  }
  if (initialResult.readError) {
    return {
      status: "error",
      candidates: [],
      nextCursor: null,
      shownCount: 0,
      loadingMore: false,
      pageFailure: initialReadError ?? { kind: "error", message: "Attendance recovery could not be loaded. Refresh and try again." },
    };
  }
  const candidates = Array.isArray(initialResult.candidates) ? initialResult.candidates : [];
  return {
    status: "ready",
    candidates,
    nextCursor: initialResult.nextCursor || null,
    shownCount: candidates.length,
    loadingMore: false,
    pageFailure: null,
  };
}

export function beginAttendanceRecoveryRead(
  state: AttendanceRecoveryState,
  append: boolean,
): AttendanceRecoveryState {
  return {
    ...state,
    status: append ? "ready" : "loading",
    loadingMore: append,
    pageFailure: null,
  };
}

export function completeAttendanceRecoveryRead(
  state: AttendanceRecoveryState,
  response: RecoveryCandidatesResponse,
  append: boolean,
): AttendanceRecoveryState {
  const page = Array.isArray(response?.candidates) ? response.candidates : [];
  const candidates = append ? [...state.candidates, ...page] : page;
  return {
    status: "ready",
    candidates,
    nextCursor: response?.nextCursor || null,
    shownCount: candidates.length,
    loadingMore: false,
    pageFailure: null,
  };
}

export function failAttendanceRecoveryRead(
  state: AttendanceRecoveryState,
  append: boolean,
  failure: RecoveryReadErrorNotice,
): AttendanceRecoveryState {
  if (append) {
    return { ...state, status: "ready", loadingMore: false, pageFailure: failure };
  }
  return {
    status: "error",
    candidates: [],
    nextCursor: null,
    shownCount: 0,
    loadingMore: false,
    pageFailure: failure,
  };
}

export function attendanceRecoveryStatus(state: AttendanceRecoveryState): string {
  if (state.status === "loading") return "Loading eligible workdays…";
  if (state.status === "error") return "Attendance recovery is unavailable.";
  return `Showing ${state.shownCount} eligible workday${state.shownCount === 1 ? "" : "s"}${state.nextCursor ? ". Older pages are available." : " in this window."}`;
}
