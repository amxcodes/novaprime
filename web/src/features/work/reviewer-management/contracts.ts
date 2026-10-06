export interface ReviewerCandidate {
  id: string;
  displayName: string;
}

export interface ReviewerManagementAssignment {
  assignmentId: string;
  taskTitle: string;
  status: string;
  assigneeName: string;
  reviewRequired: boolean;
  reviewBlockedReason: string | null;
  currentReviewer: ReviewerCandidate | null;
}

export interface ReviewerManagementPage {
  assignments: ReadonlyArray<ReviewerManagementAssignment>;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export interface ReviewerCandidatePage {
  items: ReadonlyArray<ReviewerCandidate>;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export type ReviewerManagementRead<T> =
  | { status: "ready"; data: T }
  | { status: "denied"; message: string }
  | { status: "stale"; message: string }
  | { status: "error"; message: string };

export type ReviewerManagementSaveResult =
  | { status: "saved" }
  | { status: "denied"; message: string }
  | { status: "stale"; message: string }
  | { status: "error"; message: string };

export interface ReviewerManagementProps {
  initialRead: unknown;
  onLoadAssignments(cursor: string | null): Promise<unknown>;
  onLoadCandidates(
    assignmentId: string,
    query: string,
    cursor: string | null,
  ): Promise<unknown>;
  onSaveReviewer(assignmentId: string, reviewerPersonId: string): Promise<ReviewerManagementSaveResult>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const listStatuses = new Set([
  "assigned", "in_progress", "submitted", "awaiting_review", "changes_requested",
]);

function text(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function candidate(value: unknown): ReviewerCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, 36);
  const displayName = text(row.displayName, 160);
  return id && uuidPattern.test(id) && displayName ? { id, displayName } : null;
}

export function projectReviewerManagementAssignment(value: unknown): ReviewerManagementAssignment | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const assignmentId = text(row.assignmentId, 36);
  const taskTitle = text(row.taskTitle, 500);
  const status = text(row.status, 40);
  const assigneeName = text(row.assigneeName, 160);
  if (!assignmentId || !uuidPattern.test(assignmentId) || !taskTitle || !status ||
      !listStatuses.has(status) || !assigneeName || typeof row.reviewRequired !== "boolean") return null;

  const currentReviewer = row.currentReviewer === null ? null : candidate(row.currentReviewer);
  if (row.currentReviewer !== null && !currentReviewer) return null;
  const blockedReason = row.reviewBlockedReason === null ? null : text(row.reviewBlockedReason, 240);
  if (row.reviewBlockedReason !== null && !blockedReason) return null;

  // Deliberately reconstruct the display DTO: task/assignee IDs, email, and
  // every unrecognized server field stay outside the feature presentation.
  return {
    assignmentId,
    taskTitle,
    status,
    assigneeName,
    reviewRequired: row.reviewRequired,
    reviewBlockedReason: blockedReason,
    currentReviewer,
  };
}

function projectedPageMeta(value: Record<string, unknown>, maxCursorLength: number) {
  const limit = value.limit;
  const nextCursor = value.nextCursor;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50 ||
      typeof value.hasMore !== "boolean" ||
      (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor || nextCursor.length > maxCursorLength)) ||
      (value.hasMore === true && !nextCursor)) return null;
  return { limit: Number(limit), hasMore: value.hasMore, nextCursor: nextCursor as string | null };
}

function readFailure(value: unknown, resource: string): ReviewerManagementRead<never> | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : null;
  // The host normally reduces HTTP errors to readError; also accept the API's
  // stable {error: CODE} envelope for focused contract tests/adapters.
  const code = source ? text(source.readError ?? source.error, 80) : null;
  if (!code) return null;
  if (code === "PERMISSION_DENIED" || code === "PREREQUISITE_PERMISSION_REQUIRED") {
    return { status: "denied", message: `You no longer have permission to view ${resource}. Refresh Work to check current access.` };
  }
  if (code === "STALE_PAGE_REQUEST") {
    return { status: "stale", message: "This Work page changed before the reviewer data finished loading. Refresh Work to continue." };
  }
  if (["ASSIGNMENT_NOT_FOUND", "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE", "REVIEWER_CANDIDATE_QUERY_INVALID", "REVIEWER_MANAGEMENT_QUERY_INVALID"].includes(code)) {
    return { status: "stale", message: "The assignment or reviewer results changed. Refresh the list and try again." };
  }
  return { status: "error", message: `Could not load ${resource}. Try again.` };
}

export function projectReviewerManagementListRead(value: unknown): ReviewerManagementRead<ReviewerManagementPage> {
  const failure = readFailure(value, "reviewer-managed assignments");
  if (failure) return failure;
  if (!value || typeof value !== "object") {
    return { status: "error", message: "The reviewer-managed assignment response was incomplete. Try again." };
  }
  const source = value as Record<string, unknown>;
  const meta = projectedPageMeta(source, 160);
  if (!meta || !Array.isArray(source.assignments)) {
    return { status: "error", message: "The reviewer-managed assignment response was incomplete. Try again." };
  }
  const assignments = source.assignments.map(projectReviewerManagementAssignment);
  if (assignments.length > meta.limit || assignments.some((assignment) => !assignment)) {
    return { status: "error", message: "The reviewer-managed assignment response was incomplete. Try again." };
  }
  return { status: "ready", data: { assignments: assignments as ReviewerManagementAssignment[], ...meta } };
}

export interface ReviewerManagementFocusedData {
  assignment: ReviewerManagementAssignment;
  eligibleReviewers: ReviewerCandidatePage;
}

export function projectReviewerManagementFocusedRead(value: unknown): ReviewerManagementRead<ReviewerManagementFocusedData> {
  const failure = readFailure(value, "reviewer candidates");
  if (failure) return failure;
  if (!value || typeof value !== "object") {
    return { status: "error", message: "Could not load eligible reviewers. Try again." };
  }
  const source = value as Record<string, unknown>;
  const assignment = projectReviewerManagementAssignment(source.assignment);
  const page = source.eligibleReviewers;
  if (!assignment || !page || typeof page !== "object") {
    return { status: "error", message: "Could not load eligible reviewers. Try again." };
  }
  const candidatePage = page as Record<string, unknown>;
  const meta = projectedPageMeta(candidatePage, 2048);
  if (!meta || !Array.isArray(candidatePage.items)) {
    return { status: "error", message: "Could not load eligible reviewers. Try again." };
  }
  const items = candidatePage.items.map(candidate);
  if (items.length > meta.limit || items.some((item) => !item)) {
    return { status: "error", message: "Could not load eligible reviewers. Try again." };
  }
  return {
    status: "ready",
    data: { assignment, eligibleReviewers: { items: items as ReviewerCandidate[], ...meta } },
  };
}

export function canSaveReviewerSelection(
  assignment: ReviewerManagementAssignment,
  candidates: ReadonlyArray<ReviewerCandidate>,
  reviewerId: string,
): boolean {
  return Boolean(reviewerId && reviewerId !== assignment.currentReviewer?.id &&
    candidates.some((item) => item.id === reviewerId));
}

export function applyReviewerChange(
  assignment: ReviewerManagementAssignment,
  reviewer: ReviewerCandidate,
): ReviewerManagementAssignment {
  return {
    ...assignment,
    currentReviewer: reviewer,
    reviewRequired: true,
    reviewBlockedReason: null,
  };
}
