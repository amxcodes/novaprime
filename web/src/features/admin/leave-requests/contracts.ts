export type LeaveDecision = "approved" | "rejected";

/** Minimal summary projected from the server-filtered pending-leave response. */
export interface LeaveRequestSummary {
  id: string;
  leaveType: string;
  status: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  hasConflict: boolean;
  /** Row-level eligibility returned by the server; this is not client authorization. */
  canReview: boolean;
  /** Server hint requiring both leave review and attendance recovery scope. */
  canResolveConflict: boolean;
}

export type LeaveRequestReadState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; requests: ReadonlyArray<LeaveRequestSummary> };

export type LeaveRequestActionKind = "approve" | "reject" | "resolve-conflict";

/** Mutation state is intentionally independent from the pending-list read state. */
export type LeaveRequestActionState =
  | { status: "idle" }
  | { status: "pending"; requestId: string; action: LeaveRequestActionKind }
  | { status: "feedback"; kind: "success" | "error"; message: string };

export interface LeaveRequestsProps {
  /** Only mount this module after the host's effective-grant route check succeeds. */
  read: LeaveRequestReadState;
  /** Optional record identifier from an authorized reviewer notification link. */
  focusRequestId?: string | null;
  /** Host-owned action state; the feature also guards duplicate submissions locally. */
  actions: LeaveRequestActionState;
  onReview: (requestId: string, decision: LeaveDecision) => void | Promise<void>;
  onResolveConflict: (requestId: string, decision: LeaveDecision, note: string) => void | Promise<void>;
  formatError?: (error: unknown) => string;
}
