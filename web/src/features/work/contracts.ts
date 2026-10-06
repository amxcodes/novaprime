import type { FormEvent, ReactNode } from "react";

export type WorkReadState<T> =
  | { status: "loading" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string; onRetry?: () => void }
  | { status: "partial"; data: T; message: string; onRetry?: () => void }
  | { status: "ready"; data: T };

export interface AssignmentFilters {
  status: string;
  due: string;
  search: string;
  cursor: string;
}

/** Current Mine projection. Task-only fields are omitted without tasks.view. */
export interface WorkAssignment {
  assignmentId: string;
  taskId: string;
  title: string;
  canViewTask: boolean;
  status: string;
  dueDate: string | null;
  dueDateRevision: number;
  canEditDueDate: boolean;
  canStart: boolean;
  canSubmit: boolean;
  canRequestReviewer: boolean;
  canRequestHandover: boolean;
  hasPendingReviewerRequest: boolean;
  hasPendingHandoverRequest: boolean;
  reviewRequired?: boolean;
  reviewBlockedReason?: string | null;
  resolutionSource?: string | null;
  billingClass?: string;
  billingPolicySource?: string;
  billingPolicyRevision?: number;
  taskDefinition?: { entryId: string; revision: number } | null;
  isCorrection?: boolean;
  correctionReason?: string | null;
  correctionOf?: { taskId: string; title: string } | null;
}

export interface WorkAssignmentPage {
  assignments: ReadonlyArray<WorkAssignment>;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export interface AssignmentCandidate {
  id: string;
  displayName: string;
}

export interface AssignmentCandidateRead {
  reviewers: ReadonlyArray<AssignmentCandidate>;
  handoverTargets: ReadonlyArray<AssignmentCandidate>;
  readError?: string;
}

export interface WorkMyAssignmentsProps {
  read: WorkReadState<WorkAssignmentPage>;
  filters: AssignmentFilters;
  savedViews?: ReactNode;
  focusHeading?: boolean;
  taskDetailHref: (taskId: string) => string;
  onApplyFilters: (filters: AssignmentFilters) => void;
  onClearFilters: () => void;
  onOpenTask: (taskId: string) => void;
  onStart: (assignment: WorkAssignment, source: HTMLButtonElement) => void;
  onSubmit: (assignment: WorkAssignment, source: HTMLButtonElement) => void;
  onLoadCandidates: (
    assignment: WorkAssignment,
    options?: { retry?: boolean; query?: string },
  ) => Promise<AssignmentCandidateRead>;
  onSaveDueDate: (event: FormEvent<HTMLFormElement>, assignment: WorkAssignment) => void;
  onRequestReviewer: (event: FormEvent<HTMLFormElement>, assignment: WorkAssignment) => void;
  onRequestHandover: (event: FormEvent<HTMLFormElement>, assignment: WorkAssignment) => void;
  onOlder: (cursor: string) => void;
  onNewer: () => void;
  onRetry?: () => void;
}

export interface VisibleTaskFilters {
  status: string;
  due: string;
  search: string;
  cursor: string;
}

export interface VisibleTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  client: { id: string; name: string } | null;
  workstream: { id: string; name: string; kind: "client" | "organisation" };
  group: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  assignmentCount: number;
}

export interface VisibleTaskPage {
  tasks: ReadonlyArray<VisibleTask>;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export interface WorkVisibleTasksProps {
  read: WorkReadState<VisibleTaskPage>;
  filters: VisibleTaskFilters;
  displayMode?: "list" | "board";
  savedViews?: ReactNode;
  focusTarget?: "heading" | "search" | "status" | "due" | null;
  taskDetailHref: (taskId: string) => string;
  onOpenTask: (taskId: string) => void;
  onDisplayModeChange?: (displayMode: "list" | "board") => void;
  onApplyFilters: (filters: VisibleTaskFilters, focusTarget: string) => void;
  onNewer: () => void;
  onOlder: (cursor: string) => void;
  onRetry?: () => void;
}
