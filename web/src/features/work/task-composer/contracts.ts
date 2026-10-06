export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskWorkstreamKind = "client" | "organisation";
export type TaskBillingClass = "billable" | "non_billable";

/** A route host must project only the workstream targets authorized for task creation. */
export interface TaskCreationTargetOption {
  key: string;
  id: string;
  kind: TaskWorkstreamKind;
  name: string;
  clientName?: string;
  billingPolicyClass?: TaskBillingClass | null;
  requiredGroupId?: string;
  groupName?: string;
}

/** Groups are limited to groups whose target-scoped tasks.create grant was returned by the host. */
export interface TaskGroupOption {
  id: string;
  name: string;
  workstreamId: string;
  workstreamKind: TaskWorkstreamKind;
}

/** Correction options must already be limited to visible, completed, non-correction tasks. */
export interface TaskCorrectionOption {
  id: string;
  title: string;
  workstreamId: string;
  workstreamKind: TaskWorkstreamKind;
}

export interface TaskCatalogOption {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  revision: number;
}

export interface TaskDepartmentOption {
  id: string;
  name: string;
}

/** `not-requested` means the caller did not obtain this optional list; it is not an empty result. */
export type AuthorizedOptions<T> =
  | { status: "ready"; items: readonly T[] }
  | { status: "denied" | "error"; message: string }
  | { status: "not-requested" };

export type SelfAssignmentEligibility =
  | { status: "eligible"; defaultChecked?: boolean }
  | { status: "ineligible"; message?: string }
  | { status: "unavailable"; message?: string };

export interface TaskCreateInput {
  title: string;
  clientWorkstreamId?: string;
  organisationWorkstreamId?: string;
  workGroupId?: string;
  organisationDepartmentId?: string;
  taskCatalogEntryId?: string;
  taskCatalogRevision?: number;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  correctionOfTaskId: string | null;
  correctionReason: string | null;
  assignToSelf: boolean;
}

export interface TaskComposerProps {
  heading?: string;
  description?: string;
  /** The host derives this from the actor's effective create grant and does not mount the feature when false. */
  canCreate: boolean;
  targets: AuthorizedOptions<TaskCreationTargetOption>;
  groups?: AuthorizedOptions<TaskGroupOption>;
  catalog?: AuthorizedOptions<TaskCatalogOption>;
  corrections?: AuthorizedOptions<TaskCorrectionOption>;
  departments?: AuthorizedOptions<TaskDepartmentOption>;
  selfAssignment: SelfAssignmentEligibility;
  /** Work defaults self-assignment on when allowed; Admin leaves it opt-in. */
  selfAssignmentDefault?: boolean;
  /** Admin supplies server-filtered results; work-route callers may keep their existing local options. */
  onSearchTargets?(query: string): Promise<readonly TaskCreationTargetOption[]>;
  onSearchGroups?(target: TaskCreationTargetOption, query: string): Promise<readonly TaskGroupOption[]>;
  onSearchCatalog?(target: TaskCreationTargetOption, query: string): Promise<readonly TaskCatalogOption[]>;
  onSearchCorrections?(target: TaskCreationTargetOption, query: string): Promise<readonly TaskCorrectionOption[]>;
  onSearchDepartments?(target: TaskCreationTargetOption, query: string): Promise<readonly TaskDepartmentOption[]>;
  onSubmit(input: TaskCreateInput): Promise<void>;
}
