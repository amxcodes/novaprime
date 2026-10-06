export type WorkSetupReadState<T> =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "ready"; data: T };

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type BillingClass = "billable" | "non_billable";
export type TaskRuleClass = BillingClass | null;

/** Only summaries the task-catalog endpoint already returns to this actor. */
export interface CatalogEntrySummary {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  revision: number;
  createdByName?: string | null;
}

/** Proposal DTO projection; the server continues to enforce review eligibility. */
export interface CatalogProposalSummary {
  id: string;
  action: "create" | "update" | "archive";
  title: string;
  description: string | null;
  priority: TaskPriority;
  expectedRevision: number | null;
  reason: string;
  status: string;
  proposerName: string | null;
  /** Server-computed eligibility; the client never infers self-review from names. */
  canReview: boolean;
  reviewNote?: string | null;
}

export interface TaskCatalogPermissions {
  view: boolean;
  propose: boolean;
  manage: boolean;
  review: boolean;
}

export interface TaskCatalogSnapshot {
  entries: ReadonlyArray<CatalogEntrySummary>;
  proposals: ReadonlyArray<CatalogProposalSummary>;
}

export interface CatalogEntryInput {
  title: string;
  description: string | null;
  priority: TaskPriority;
  reason: string;
}

export interface CatalogEntryRevisionInput extends CatalogEntryInput {
  expectedRevision: number;
}

export interface CatalogArchiveInput {
  reason: string;
  expectedRevision: number;
}

export interface CatalogReviewInput {
  decision: "approved" | "rejected";
  reviewNote: string | null;
}

export type CatalogMutationOutcome = "saved" | "pending" | "stale";

export interface TaskCatalogSectionProps {
  permissions: TaskCatalogPermissions;
  read: WorkSetupReadState<TaskCatalogSnapshot>;
  onCreate: (input: CatalogEntryInput) => Promise<CatalogMutationOutcome>;
  onUpdate: (entryId: string, input: CatalogEntryRevisionInput) => Promise<CatalogMutationOutcome>;
  onArchive: (entryId: string, input: CatalogArchiveInput) => Promise<CatalogMutationOutcome>;
  onReview: (proposalId: string, input: CatalogReviewInput) => Promise<CatalogMutationOutcome>;
  onRetry?: () => void;
}

/** Workstream rows are pre-filtered by the host to current billing-manager scope. */
export interface BillingWorkstreamSummary {
  id: string;
  clientName: string;
  name: string;
  policyClass: BillingClass | null;
  policyRevision: number;
}

export interface BillingRulesEntrySummary {
  entryId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  catalogRevision: number;
  billingClass: BillingClass | null;
  ruleRevision: number;
}

export interface BillingRulesSnapshot {
  defaultClass: BillingClass | null;
  defaultRevision: number;
  entries: ReadonlyArray<BillingRulesEntrySummary>;
}

export interface BillingDefaultInput {
  policyClass: BillingClass;
  expectedRevision: number;
  reason: string;
}

export interface BillingRuleInput {
  policyClass: TaskRuleClass;
  expectedRevision: number;
  reason: string;
}

export interface BillingMutationResult {
  policyClass: TaskRuleClass;
  revision: number;
}

export type CatalogAccessState = "available" | "loading" | "denied" | "error" | "missing";

export interface BillingPolicySectionProps {
  workstreams: WorkSetupReadState<ReadonlyArray<BillingWorkstreamSummary>>;
  /** Catalog view/manage is a separate capability from billing-policy management. */
  catalogAccess: CatalogAccessState;
  onLoadRules: (workstreamId: string, query?: string) => Promise<BillingRulesSnapshot>;
  onSearchWorkstreams: (query: string) => Promise<ReadonlyArray<BillingWorkstreamSummary>>;
  onSaveDefault: (workstreamId: string, input: BillingDefaultInput) => Promise<BillingMutationResult>;
  onSaveRule: (workstreamId: string, entryId: string, input: BillingRuleInput) => Promise<BillingMutationResult>;
  onRetryWorkstreams?: () => void;
  onRetryCatalog?: () => void;
}
