/** Browser projection returned by GET /api/work/assignments/mine. */
export interface MyAssignmentSummary {
  assignmentId: string;
  taskId: string;
  title: string;
  canViewTask: boolean;
  status: string;
  dueDate: string | null;
}

export interface MyAssignmentsPage {
  assignments: ReadonlyArray<MyAssignmentSummary>;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

/** The route host owns reads, permissions, and retry lifetimes. */
export type AssignmentListReadState =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string; onRetry?: () => void | Promise<void> }
  | { status: "ready"; data: MyAssignmentsPage }
  | {
      status: "partial";
      data: MyAssignmentsPage;
      message: string;
      onRetry?: () => void | Promise<void>;
    };

export interface AssignmentListProps {
  read: AssignmentListReadState;
  /** Navigation is supplied by the host so this feature does not own routing. */
  onOpenWork?: () => void;
}
import type { ReactNode } from "react";


/** Feature row shared by collection-level assignment screens. */
export interface AssignmentSummaryRowProps {
  assignment: MyAssignmentSummary;
  title: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
}
