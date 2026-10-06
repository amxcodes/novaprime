import type {
  WfhPolicyListReadState,
  WfhPolicyOverridesProps,
  WfhPolicySummary,
  WfhPolicyTargetOption,
  WfhPolicyTargetReadState,
  WfhPolicyTargetType,
} from "./wfh-policy-contracts";

interface ReadIssue {
  message: string;
}

interface ReadInput {
  result: unknown;
  authorized: boolean;
  issue?: ReadIssue | null;
}

/** Raw Admin reads are accepted only here; the existing component gets minimal feature rows. */
export interface WfhPolicyOverridesProjectionInput extends Omit<
  WfhPolicyOverridesProps,
  "policyRead" | "targetReads" | "canView" | "canManage"
> {
  canView: boolean;
  canManage: boolean;
  policies: ReadInput;
  targets: Readonly<Record<WfhPolicyTargetType, ReadInput>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isTargetType(value: unknown): value is WfhPolicyTargetType {
  return value === "office" || value === "organisation_department" || value === "person";
}

function projectPolicy(value: unknown): WfhPolicySummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() ||
      !isTargetType(value.targetType) ||
      typeof value.allowed !== "boolean" || !isDate(value.effectiveOn) ||
      !(value.effectiveUntil === undefined || value.effectiveUntil === null || isDate(value.effectiveUntil)) ||
      !(value.targetName === undefined || value.targetName === null || typeof value.targetName === "string") ||
      !(value.reason === undefined || value.reason === null || typeof value.reason === "string")) return null;

  return {
    id: value.id,
    targetType: value.targetType,
    targetName: typeof value.targetName === "string" ? value.targetName : null,
    allowed: value.allowed,
    effectiveOn: value.effectiveOn,
    effectiveUntil: typeof value.effectiveUntil === "string" ? value.effectiveUntil : null,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

function projectTarget(value: unknown, type: WfhPolicyTargetType): WfhPolicyTargetOption | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  if (type === "office" || type === "organisation_department") {
    return typeof value.name === "string" && value.name.trim()
      ? { id: value.id, name: value.name }
      : null;
  }
  if (!(value.displayName === undefined || value.displayName === null || typeof value.displayName === "string") ||
      !(value.email === undefined || value.email === null || typeof value.email === "string")) return null;
  return {
    id: value.id,
    displayName: typeof value.displayName === "string" ? value.displayName : null,
    email: typeof value.email === "string" ? value.email : null,
  };
}

function readProblem(result: unknown, issue: ReadIssue | null | undefined, resource: string): {
  status: "unavailable" | "error";
  message: string;
} | null {
  const code = isRecord(result) && typeof result.readError === "string" ? result.readError : null;
  if (!code && !issue) return null;
  const unavailable = code === "PERMISSION_DENIED" || code === "PREREQUISITE_PERMISSION_REQUIRED";
  return {
    status: unavailable ? "unavailable" : "error",
    message: issue?.message || `Could not load ${resource}. Refresh Admin to try again.`,
  };
}

function projectPolicyRead(input: ReadInput, canView: boolean): WfhPolicyListReadState {
  if (!canView || !input.authorized) return { status: "unavailable", policies: [] };
  if (isRecord(input.result) && input.result.readState === "loading") return { status: "loading", policies: [] };
  const problem = readProblem(input.result, input.issue, "WFH overrides");
  if (problem) return problem.status === "unavailable"
    ? { status: "unavailable", policies: [] }
    : { status: "error", policies: [], error: problem.message };
  if (!isRecord(input.result) || !Array.isArray(input.result.policies)) {
    return { status: "error", policies: [], error: "The WFH override response could not be read. Refresh Admin to try again." };
  }
  const policies = input.result.policies.map(projectPolicy);
  if (policies.some((policy) => policy === null)) {
    return { status: "error", policies: [], error: "The WFH override response could not be read. Refresh Admin to try again." };
  }
  return { status: "ready", policies: policies as WfhPolicySummary[] };
}

function projectTargetRead(
  input: ReadInput,
  type: WfhPolicyTargetType,
  key: "offices" | "departments" | "people",
  canManage: boolean,
): WfhPolicyTargetReadState {
  if (!canManage || !input.authorized) return { status: "unavailable", targets: [] };
  if (isRecord(input.result) && input.result.readState === "loading") return { status: "loading", targets: [] };
  const problem = readProblem(input.result, input.issue, `${type} targets`);
  if (problem) return problem.status === "unavailable"
    ? { status: "unavailable", targets: [] }
    : { status: "error", targets: [], error: problem.message };
  if (!isRecord(input.result) || !Array.isArray(input.result[key])) {
    return { status: "error", targets: [], error: `The ${type} target response could not be read. Refresh Admin to try again.` };
  }
  const targets = input.result[key].map((row) => projectTarget(row, type));
  if (targets.some((target) => target === null)) {
    return { status: "error", targets: [], error: `The ${type} target response could not be read. Refresh Admin to try again.` };
  }
  return { status: "ready", targets: targets as WfhPolicyTargetOption[] };
}

export function projectWfhPolicyOverridesProps(
  input: WfhPolicyOverridesProjectionInput,
): WfhPolicyOverridesProps {
  const canView = input.canView === true;
  const canManage = input.canManage === true;
  return {
    canView,
    canManage,
    policyRead: projectPolicyRead(input.policies, canView),
    targetReads: {
      office: projectTargetRead(input.targets.office, "office", "offices", canManage),
      organisation_department: projectTargetRead(
        input.targets.organisation_department,
        "organisation_department",
        "departments",
        canManage,
      ),
      person: projectTargetRead(input.targets.person, "person", "people", canManage),
    },
    onCreate: input.onCreate,
    createError: input.createError,
    isCreating: input.isCreating,
  };
}
