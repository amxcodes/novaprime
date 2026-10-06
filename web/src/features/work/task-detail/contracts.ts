import type { FormEvent } from "react";

/** Display-only task fields. Record identifiers and write revisions stay in the route host. */
export interface WorkTaskDetailRecord {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string | null;
  dueDate: string | null;
  canEditDueDate: boolean;
  billingClass: string | null;
  billingPolicySource: string | null;
  billingPolicyRevision: number | null;
  taskDefinitionRevision: number | null;
  isCorrection: boolean;
  correctionReason: string | null;
  correctionTitle: string | null;
  clientName: string | null;
  workstreamName: string | null;
  workstreamKind: "client" | "organisation";
  groupName: string | null;
  departmentName: string | null;
  /** The API may intentionally return only the current viewer's assignment. */
  assignments: ReadonlyArray<WorkTaskDetailAssignment>;
}

export interface WorkTaskDetailAssignment {
  personName: string | null;
  reviewerName: string | null;
  reviewRequired: boolean;
  reviewBlockedReason: string | null;
  status: string;
}

export type WorkTaskDetailRead =
  | { status: "loading" }
  | { status: "unavailable"; message: string; canRetry: boolean }
  | { status: "ready"; data: WorkTaskDetailRecord };

export type DueDateSaveResult =
  | { status: "saved" | "unchanged"; dueDate: string | null; message: string }
  | { status: "conflict" | "error"; message: string }
  | { status: "aborted" };

export interface WorkTaskDetailProps {
  read: WorkTaskDetailRead;
  onBack: () => void;
  onRetry: () => void;
  onSaveDueDate: (form: HTMLFormElement) => Promise<DueDateSaveResult>;
}
