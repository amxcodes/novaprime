import type {
  WfhPendingRequestSummary,
  WfhRequestReadState,
  WfhRequestsReviewProps,
} from "./contracts";

interface ReadIssue {
  status: "unavailable" | "error";
  message: string;
}

/** Raw host response accepted only here; the reviewer UI gets allowlisted request summaries. */
export interface WfhRequestsReviewProjectionInput extends Omit<
  WfhRequestsReviewProps,
  "readState" | "readEligibility" | "actionEligibility"
> {
  result: unknown;
  failure?: ReadIssue | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectRequest(value: unknown): WfhPendingRequestSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() ||
      typeof value.startDate !== "string" || typeof value.endDate !== "string" ||
      !(value.reason === undefined || value.reason === null || typeof value.reason === "string")) return null;
  return {
    id: value.id,
    startDate: value.startDate,
    endDate: value.endDate,
    reason: typeof value.reason === "string" ? value.reason : null,
    canReview: value.canReview === true,
  };
}

function readFailure(result: unknown, failure: ReadIssue | null | undefined): ReadIssue | null {
  if (failure) return failure;
  if (!isRecord(result) || typeof result.readError !== "string") return null;
  const unavailable = result.readError === "PERMISSION_DENIED" || result.readError === "PREREQUISITE_PERMISSION_REQUIRED";
  return {
    status: unavailable ? "unavailable" : "error",
    message: "Pending WFH requests are unavailable. Refresh Admin to try again.",
  };
}

/** Keep read, action, and row eligibility separate while dropping raw request fields. */
export function projectWfhRequestsReviewProps(input: WfhRequestsReviewProjectionInput): WfhRequestsReviewProps {
  const failure = readFailure(input.result, input.failure);
  let readState: WfhRequestReadState;
  if (failure) {
    readState = failure;
  } else if (isRecord(input.result) && input.result.readState === "loading") {
    readState = { status: "loading" };
  } else if (!isRecord(input.result) || !Array.isArray(input.result.requests)) {
    readState = { status: "error", message: "The pending WFH response could not be read. Refresh Admin to try again." };
  } else {
    const requests = input.result.requests.map(projectRequest);
    readState = requests.some((request) => request === null)
      ? { status: "error", message: "The pending WFH response could not be read. Refresh Admin to try again." }
      : { status: "ready", requests: requests as WfhPendingRequestSummary[] };
  }

  return {
    // The parent mounts this boundary only after the exact WFH review grant passes.
    readEligibility: { allowed: true },
    actionEligibility: { allowed: true },
    readState,
    focusRequestId: input.focusRequestId,
    onReview: input.onReview,
  };
}
