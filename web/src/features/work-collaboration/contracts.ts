/** Safe, host-projected fields from one authorized collaboration-request row. */
export interface CollaborationRequestSummary {
  /** Opaque identifier passed back to the host for an authorized command. */
  id: string;
  title: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  /** Current actor-scoped relationship category projected by the host. */
  kind: CollaborationRequestKind;
  requestKind: "initial" | "replacement" | "handover";
  /** Terminal statuses are shown as history and never receive actions. */
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
  resolvedAt: string | null;
  /** Server-projected relationship to the current actor. */
  isRecipient: boolean;
  /** Server-projected row capabilities; presentation must not derive these. */
  canAccept: boolean;
  canDecline: boolean;
  canWithdraw: boolean;
}

export type CollaborationRequestDecision = "accept" | "decline" | "withdraw";
export type CollaborationRequestKind = "reviewer" | "handover";

export interface FocusedCollaborationRequest {
  kind: CollaborationRequestKind;
  id: string;
}

export type CollaborationRequestReadState =
  | { status: "loading" }
  /** The host interpreted an access denial for this particular read. */
  | { status: "denied"; message?: string; onRetry?: () => void }
  /** Transport or service errors stay isolated to this request collection. */
  | { status: "error"; message: string; onRetry?: () => void }
  | {
      status: "ready";
      /** Pending rows in the latest actor-scoped records returned by the endpoint. */
      requests: ReadonlyArray<CollaborationRequestSummary>;
      /** Resolved rows from the same actor-scoped page, with no decision actions. */
      history: ReadonlyArray<CollaborationRequestSummary>;
      /** Total rows returned by the endpoint before the host filters pending rows. */
      loadedRecordCount: number;
      /** Endpoint limit (currently 100); used to communicate possible truncation. */
      recordLimit: number;
    };

export interface WorkCollaborationRequestsProps {
  /** Omit when the capability read plan does not authorize this endpoint. */
  reviewerRequests?: CollaborationRequestReadState;
  /** Omit when the capability read plan does not authorize this endpoint. */
  handoverRequests?: CollaborationRequestReadState;
  /** Exact actor-scoped request addressed by a validated Work deep link. */
  focusRequest?: FocusedCollaborationRequest | null;
  onResolve: (
    kind: CollaborationRequestKind,
    request: CollaborationRequestSummary,
    decision: CollaborationRequestDecision,
  ) => void | Promise<void>;
}
