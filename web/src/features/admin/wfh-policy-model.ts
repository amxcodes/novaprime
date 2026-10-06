import type {
  WfhPolicyCreateInput,
  WfhPolicyDraft,
  WfhPolicyFieldErrors,
  WfhPolicyTargetOption,
  WfhPolicyTargetType,
} from "./wfh-policy-contracts";

const targetTypeLabels: Readonly<Record<WfhPolicyTargetType, string>> = {
  office: "Office",
  organisation_department: "Department",
  person: "Person",
};

export function wfhPolicyTargetTypeLabel(type: WfhPolicyTargetType): string {
  return targetTypeLabels[type];
}

export function wfhPolicyTargetLabel(target: WfhPolicyTargetOption): string {
  return target.name?.trim() || target.displayName?.trim() || target.email?.trim() || "Unnamed target";
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export type WfhPolicyDraftResult =
  | { input: WfhPolicyCreateInput; errors: {} }
  | { input: null; errors: WfhPolicyFieldErrors };

/** Validate against the supplied target rows so stale or invented IDs never reach onCreate. */
export function buildWfhPolicyInput(
  draft: WfhPolicyDraft,
  targets: ReadonlyArray<WfhPolicyTargetOption>,
): WfhPolicyDraftResult {
  const errors: WfhPolicyFieldErrors = {};
  const targetExists = targets.some((target) => target.id === draft.targetId);
  if (!targetExists) errors.targetId = "Choose an available target.";
  if (!isValidDate(draft.effectiveOn)) errors.effectiveOn = "Enter a valid effective start date.";
  if (draft.effectiveUntil && !isValidDate(draft.effectiveUntil)) {
    errors.effectiveUntil = "Enter a valid effective end date.";
  } else if (draft.effectiveUntil && draft.effectiveOn && draft.effectiveUntil < draft.effectiveOn) {
    errors.effectiveUntil = "Effective until must be on or after the start date.";
  }
  const reason = draft.reason.trim();
  if (reason.length > 2000) errors.reason = "Reason must be 2,000 characters or fewer.";

  if (Object.keys(errors).length) return { input: null, errors };
  return {
    input: {
      targetType: draft.targetType,
      targetId: draft.targetId,
      allowed: draft.allowed,
      effectiveOn: draft.effectiveOn,
      ...(draft.effectiveUntil ? { effectiveUntil: draft.effectiveUntil } : {}),
      ...(reason ? { reason } : {}),
    },
    errors: {},
  };
}
