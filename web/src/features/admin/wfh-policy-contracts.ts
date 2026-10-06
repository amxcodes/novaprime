/** API-shaped contracts for the independently permissioned WFH policy feature. */
export type WfhPolicyTargetType = "office" | "organisation_department" | "person";

export interface WfhPolicyCreateInput {
  targetType: WfhPolicyTargetType;
  targetId: string;
  allowed: boolean;
  effectiveOn: string;
  effectiveUntil?: string;
  reason?: string;
}

export interface WfhPolicyDraft {
  targetType: WfhPolicyTargetType;
  targetId: string;
  allowed: boolean;
  effectiveOn: string;
  effectiveUntil: string;
  reason: string;
}

export type WfhPolicyFieldErrors = Partial<Record<"targetId" | "effectiveOn" | "effectiveUntil" | "reason", string>>;

export interface WfhPolicySearchOption {
  value: string;
  label: string;
}

export type WfhPolicyTargetReadState =
  | { status: "unavailable" }
  | { status: "ready" };

export interface WfhPolicyRecord {
  id: string;
  targetType: WfhPolicyTargetType;
  targetId: string;
  targetName?: string | null;
  allowed: boolean;
  effectiveOn: string;
  effectiveUntil?: string | null;
  reason?: string | null;
}

/** Only fields used by the policy list; target identity stays at the host boundary. */
export type WfhPolicySummary = Omit<WfhPolicyRecord, "targetId">;

export type WfhPolicyListReadState =
  | { status: "loading"; policies: ReadonlyArray<WfhPolicySummary> }
  | { status: "unavailable"; policies: ReadonlyArray<WfhPolicySummary> }
  | { status: "error"; policies: ReadonlyArray<WfhPolicySummary>; error?: string }
  | { status: "ready"; policies: ReadonlyArray<WfhPolicySummary> };

export interface WfhPolicyOverridesProps {
  canView: boolean;
  canManage: boolean;
  policyRead: WfhPolicyListReadState;
  targetReads: Readonly<Record<WfhPolicyTargetType, WfhPolicyTargetReadState>>;
  /** Search is delegated to the permission-checked server directory. */
  onSearchTargets?: (type: WfhPolicyTargetType, query: string) => Promise<ReadonlyArray<WfhPolicySearchOption>>;
  onCreate(input: WfhPolicyCreateInput): void | Promise<void>;
  createError?: string;
  isCreating?: boolean;
}
