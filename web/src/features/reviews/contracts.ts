/** Safe, host-projected fields from one authorized pending-review row. */
export interface PendingReviewSummary {
  assignmentId: string;
  title: string;
  reviewCycleId: string;
  cycleNumber: number;
  submittedAt: string;
  /** Host projection of the server's row-level `canReview` capability. */
  canDecide: boolean;
  /** Existing host-owned in-memory draft, if any. */
  draft?: ReviewFeedbackDraft | null;
}

export interface ReviewFeedbackDraft {
  sourceReviewCycleId: string;
  acknowledgedReviewCycleId: string | null;
  feedback: string;
}

export type PendingReviewReadState =
  | { status: "loading" }
  /** The host has already interpreted a planned read's access denial. */
  | { status: "denied"; message?: string }
  /** Messages are safe, user-facing text; raw transport errors stay in the host. */
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; reviews: ReadonlyArray<PendingReviewSummary>; requestLimit: number };

/** Authorized, presentation-safe projection of the reviewer detail endpoint. */
export interface ReviewContextSummary {
  assigneeName: string | null;
  taskTitle: string;
  taskDescription: string | null;
  taskStatus: string | null;
  priority: string | null;
  dueDate: string | null;
  clientName: string | null;
  workstreamName: string | null;
  groupName: string | null;
  submittedAt: string | null;
}

export interface ReviewCycleSummary {
  reviewCycleId: string;
  cycleNumber: number;
  decision: string | null;
  submittedAt: string;
  decidedAt: string | null;
  feedback: string | null;
  isCurrent: boolean;
}

export interface ReviewContextDetail {
  review: ReviewContextSummary;
  history: ReadonlyArray<ReviewCycleSummary>;
  historyTruncated: boolean;
}

export type ReviewContextReadState =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string }
  | { status: "unavailable"; message?: string }
  | { status: "ready"; detail: ReviewContextDetail };

export interface ReviewsPageProps {
  queue: PendingReviewReadState;
  /** Optional route focus request; matched rows are scrolled into view and focused. */
  focusAssignmentId?: string;
  /** Omit when no review-context route is selected. */
  context?: ReviewContextReadState;
  onOpenContext: (assignmentId: string) => void;
  onApprove: (review: PendingReviewSummary) => void | Promise<void>;
  onRequestChanges: (review: PendingReviewSummary, feedback: string) => void | Promise<void>;
  onDraftChange: (assignmentId: string, draft: ReviewFeedbackDraft) => void;
  onRetryQueue?: () => void;
  onRetryContext?: () => void;
}
