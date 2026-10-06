import type {
  LeaveRequestReadState,
  LeaveRequestSummary,
  LeaveRequestsProps,
} from "./contracts";

interface ReadIssue {
  status: "unavailable" | "error";
  message: string;
}

/** Raw host read accepted only at this boundary; no person or audit details reach the view. */
export interface LeaveRequestsProjectionInput extends Omit<LeaveRequestsProps, "read"> {
  result: unknown;
  failure?: ReadIssue | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectRequest(value: unknown): LeaveRequestSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() ||
      typeof value.startDate !== "string" || typeof value.endDate !== "string" ||
      !(value.reason === undefined || value.reason === null || typeof value.reason === "string") ||
      typeof value.hasConflict !== "boolean") return null;

  return {
    id: value.id,
    leaveType: typeof value.leaveType === "string" && value.leaveType.trim() ? value.leaveType : "Leave",
    status: typeof value.status === "string" && value.status.trim() ? value.status : "unknown",
    startDate: value.startDate,
    endDate: value.endDate,
    reason: typeof value.reason === "string" ? value.reason : null,
    hasConflict: value.hasConflict,
    canReview: value.canReview === true,
    // Conflict resolution requires all row hints; the server remains the authority.
    canResolveConflict: value.hasConflict && value.canReview === true && value.canResolveConflict === true,
  };
}

function readFailure(result: unknown, failure: ReadIssue | null | undefined): ReadIssue | null {
  if (failure) return failure;
  if (!isRecord(result) || typeof result.readError !== "string") return null;
  const unavailable = result.readError === "PERMISSION_DENIED" || result.readError === "PREREQUISITE_PERMISSION_REQUIRED";
  return {
    status: unavailable ? "unavailable" : "error",
    message: "Pending leave requests are unavailable. Refresh Admin to try again.",
  };
}

/** Validate and project only the summary and server-provided review hints used by Leave Review. */
export function projectLeaveRequestsProps(input: LeaveRequestsProjectionInput): LeaveRequestsProps {
  const failure = readFailure(input.result, input.failure);
  let read: LeaveRequestReadState;
  if (failure) {
    read = failure;
  } else if (isRecord(input.result) && input.result.readState === "loading") {
    read = { status: "loading" };
  } else if (!isRecord(input.result) || !Array.isArray(input.result.requests)) {
    read = { status: "error", message: "The pending leave response could not be read. Refresh Admin to try again." };
  } else {
    const requests = input.result.requests.map(projectRequest);
    read = requests.some((request) => request === null)
      ? { status: "error", message: "The pending leave response could not be read. Refresh Admin to try again." }
      : { status: "ready", requests: requests as LeaveRequestSummary[] };
  }

  return {
    read,
    focusRequestId: input.focusRequestId,
    actions: input.actions,
    onReview: input.onReview,
    onResolveConflict: input.onResolveConflict,
    formatError: input.formatError,
  };
}
