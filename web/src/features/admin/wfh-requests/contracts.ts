/** Minimal server-authorized summary. Never pass the raw request DTO here. */
export interface WfhPendingRequestSummary {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  /** Row-level eligibility from the server, including its self-review check. */
  canReview: boolean;
}

export type WfhRequestReadState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; requests: readonly WfhPendingRequestSummary[] };

export type WfhRequestEligibility =
  | { allowed: true }
  | { allowed: false; message?: string };

export type WfhRequestDecision = "approved" | "rejected";

/** A review reason is optional for both decisions and capped by the API at 2,000 characters. */
export interface WfhRequestReviewCommand {
  decision: WfhRequestDecision;
  reason?: string;
}

export interface WfhRequestsReviewProps {
  /** Read and decision eligibility are separate; neither is inferred from a role name. */
  readEligibility: WfhRequestEligibility;
  actionEligibility: WfhRequestEligibility;
  readState: WfhRequestReadState;
  /** Optional record identifier from an authorized reviewer notification link. */
  focusRequestId?: string | null;
  /** Host owns transport, current-page/identity checks, error mapping, and refresh. */
  onReview: (requestId: string, command: WfhRequestReviewCommand) => void | Promise<void>;
}
