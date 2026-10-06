export type WorkOperationsRead<T> =
  | { status: "ready"; items: ReadonlyArray<T> }
  | { status: "unavailable" | "error"; message: string };

export interface WorkOperationsOption {
  id: string;
  name: string;
}

export interface WorkOperationsAssignmentOptions {
  assignees: ReadonlyArray<WorkOperationsOption>;
  reviewers: ReadonlyArray<WorkOperationsOption>;
}

export interface WorkOperationsAssignmentOptionsReadOptions {
  /** Refresh choices when an assignment/reassignment panel is opened again. */
  refresh?: boolean;
}

export interface WorkOperationsAssignment {
  id: string;
  personId: string;
  personName: string;
  reviewerPersonId: string | null;
  reviewerName: string | null;
  reviewRequired: boolean;
  resolutionSource: string | null;
  reviewBlockedReason: string | null;
  status: string;
  canReassign: boolean;
}

export interface WorkOperationsTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  clientName: string | null;
  workstreamName: string;
  workstreamKind: "client" | "organisation";
  dueDate: string | null;
  dueDateRevision: number;
  billingConfirmation: string;
  definitionProvenance: string;
  isCorrection: boolean;
  correctionOfTitle: string | null;
  correctionReason: string | null;
  canEditDueDate: boolean;
  canAssign: boolean;
  canCancel: boolean;
  assignments: ReadonlyArray<WorkOperationsAssignment>;
}

export interface WorkOperationsAssignmentInput {
  personId: string;
  reviewerPersonId: string | null;
  reviewRequired: boolean;
}

export interface WorkOperationsReassignmentInput {
  personId: string;
  reviewerPersonId: string | null;
  reviewRequired: boolean;
}

export interface WorkOperationsDueDateInput {
  dueDate: string | null;
  expectedDueDate: string | null;
  expectedDueDateRevision: number;
}

export interface WorkOperationsProps {
  taskRead: WorkOperationsRead<WorkOperationsTask>;
  loadAssignmentOptions(taskId: string, options?: WorkOperationsAssignmentOptionsReadOptions): Promise<WorkOperationsAssignmentOptions>;
  onAssign(taskId: string, input: WorkOperationsAssignmentInput): void | Promise<void>;
  onReassign(taskId: string, assignmentId: string, input: WorkOperationsReassignmentInput): void | Promise<void>;
  onCancel(taskId: string): void | Promise<void>;
  onUpdateDueDate(taskId: string, input: WorkOperationsDueDateInput): void | Promise<void>;
}

export type WorkOperationsTaskPermission = "tasks.edit" | "tasks.assign" | "tasks.reassign";
export type WorkOperationsTaskPermissionCheck = (
  permission: WorkOperationsTaskPermission,
  task: Readonly<Record<string, unknown>>,
) => boolean;

export interface WorkOperationsProjectionInput {
  taskRead: WorkOperationsRead<unknown>;
  hasTaskPermission: WorkOperationsTaskPermissionCheck;
}
