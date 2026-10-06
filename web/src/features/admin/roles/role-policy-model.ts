import type { RoleOperationalPolicy } from "./contracts";

export type RoleOperationalPolicyKey = keyof RoleOperationalPolicy;

const policyPrerequisites: Partial<Record<RoleOperationalPolicyKey, RoleOperationalPolicyKey>> = Object.freeze({
  payrollAttendanceContributes: "payrollApplicable",
  payrollOvertimeApplicable: "payrollApplicable",
});

export function roleOperationalPolicyPrerequisite(
  key: RoleOperationalPolicyKey,
): RoleOperationalPolicyKey | undefined {
  return policyPrerequisites[key];
}

export function isRoleOperationalPolicyFieldEnabled(
  policy: RoleOperationalPolicy,
  key: RoleOperationalPolicyKey,
): boolean {
  const prerequisite = roleOperationalPolicyPrerequisite(key);
  return !prerequisite || policy[prerequisite];
}

/** Keep dependent policy choices valid before the server/database checks them. */
export function updateRoleOperationalPolicy(
  policy: RoleOperationalPolicy,
  key: RoleOperationalPolicyKey,
  value: boolean,
): RoleOperationalPolicy {
  if (value && !isRoleOperationalPolicyFieldEnabled(policy, key)) return policy;

  const next = { ...policy, [key]: value };
  if (!value) {
    for (const [dependent, prerequisite] of Object.entries(policyPrerequisites) as Array<[
      RoleOperationalPolicyKey,
      RoleOperationalPolicyKey,
    ]>) {
      if (prerequisite === key) next[dependent] = false;
    }
  }
  return next;
}
