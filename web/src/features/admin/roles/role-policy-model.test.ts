import { describe, expect, it } from "bun:test";
import type { RoleOperationalPolicy } from "./contracts";
import {
  isRoleOperationalPolicyFieldEnabled,
  roleOperationalPolicyPrerequisite,
  updateRoleOperationalPolicy,
} from "./role-policy-model";

const policy: RoleOperationalPolicy = {
  workEnabled: true,
  canReceiveAssignments: false,
  attendanceRequired: false,
  wfhAllowed: false,
  canWorkWithoutAttendance: false,
  payrollApplicable: false,
  payrollAttendanceContributes: false,
  payrollOvertimeApplicable: false,
};

describe("role operational policy dependencies", () => {
  it("requires payroll eligibility before attendance or overtime can contribute", () => {
    expect(roleOperationalPolicyPrerequisite("payrollAttendanceContributes")).toBe("payrollApplicable");
    expect(roleOperationalPolicyPrerequisite("payrollOvertimeApplicable")).toBe("payrollApplicable");
    expect(isRoleOperationalPolicyFieldEnabled(policy, "payrollAttendanceContributes")).toBe(false);
    expect(isRoleOperationalPolicyFieldEnabled(policy, "payrollOvertimeApplicable")).toBe(false);
    expect(isRoleOperationalPolicyFieldEnabled(policy, "payrollApplicable")).toBe(true);
  });

  it("does not allow dependent settings to bypass a disabled prerequisite", () => {
    expect(updateRoleOperationalPolicy(policy, "payrollAttendanceContributes", true)).toEqual(policy);
    expect(updateRoleOperationalPolicy(policy, "payrollOvertimeApplicable", true)).toEqual(policy);
  });

  it("clears dependent settings when payroll eligibility is disabled", () => {
    const eligible = {
      ...policy,
      payrollApplicable: true,
      payrollAttendanceContributes: true,
      payrollOvertimeApplicable: true,
    };

    expect(updateRoleOperationalPolicy(eligible, "payrollApplicable", false)).toMatchObject({
      payrollApplicable: false,
      payrollAttendanceContributes: false,
      payrollOvertimeApplicable: false,
    });
  });
});
