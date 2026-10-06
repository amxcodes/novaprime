import { describe, expect, it } from "bun:test";
import { projectWfhPolicyOverridesProps } from "./wfh-policy-projection";
import type { WfhPolicyOverridesProjectionInput } from "./wfh-policy-projection";

const policy = {
  id: "policy-1",
  targetType: "person",
  targetId: "private-target-id",
  targetName: "Jordan Lee",
  allowed: false,
  effectiveOn: "2026-10-01",
  effectiveUntil: null,
  reason: "Temporary arrangement",
  actorId: "private-actor-id",
  audit: { token: "private-audit-data" },
};

function input(overrides: Partial<WfhPolicyOverridesProjectionInput> = {}): WfhPolicyOverridesProjectionInput {
  return {
    canView: true,
    canManage: true,
    policies: { authorized: true, result: { policies: [policy] } },
    targets: {
      office: { authorized: true, result: { offices: [{ id: "office-1", name: "Central", private: "drop" }] } },
      organisation_department: { authorized: true, result: { departments: [{ id: "department-1", name: "People", private: "drop" }] } },
      person: { authorized: true, result: { people: [{
        id: "person-1", displayName: "Jordan Lee", email: "jordan@example.test", status: "private-status", role: { name: "private-role" },
      }] } },
    },
    onSearchTargets: async () => [{ value: "person-1", label: "Jordan Lee" }],
    onCreate: async () => {},
    ...overrides,
  };
}

describe("WFH policy feature projection", () => {
  it("projects only list fields and leaves target rows for permission-checked server search", () => {
    const props = projectWfhPolicyOverridesProps(input());
    expect(props.policyRead).toEqual({ status: "ready", policies: [{
      id: "policy-1",
      targetType: "person",
      targetName: "Jordan Lee",
      allowed: false,
      effectiveOn: "2026-10-01",
      effectiveUntil: null,
      reason: "Temporary arrangement",
    }] });
    expect(props.targetReads.office).toEqual({ status: "ready" });
    expect(props.targetReads.organisation_department).toEqual({ status: "ready" });
    expect(props.targetReads.person).toEqual({ status: "ready" });
    expect(typeof props.onSearchTargets).toBe("function");
    expect(JSON.stringify(props)).not.toContain("private-target-id");
    expect(JSON.stringify(props)).not.toContain("private-actor-id");
    expect(JSON.stringify(props)).not.toContain("private-role");
    expect(JSON.stringify(props)).not.toContain("private-status");
    expect(JSON.stringify(props)).not.toContain("private-audit-data");
  });

  it("keeps view and manage independent so manage-only cannot see supplied rows", () => {
    const props = projectWfhPolicyOverridesProps(input({
      canView: false,
      canManage: true,
      policies: { authorized: false, result: { policies: [policy] } },
    }));
    expect(props.canView).toBe(false);
    expect(props.canManage).toBe(true);
    expect(props.policyRead).toEqual({ status: "unavailable", policies: [] });
    expect(props.targetReads.office.status).toBe("ready");
    expect(JSON.stringify(props.policyRead)).not.toContain("Jordan Lee");
  });

  it("does not project office, department, or person rows when their independent target permission is absent", () => {
    const props = projectWfhPolicyOverridesProps(input({
      targets: {
        office: { authorized: false, result: { offices: [{ id: "private-office", name: "Private office" }] } },
        organisation_department: { authorized: false, result: { departments: [{ id: "private-dept", name: "Private dept" }] } },
        person: { authorized: false, result: { people: [{ id: "private-person", displayName: "Private person" }] } },
      },
    }));
    expect(props.targetReads.office).toEqual({ status: "unavailable" });
    expect(props.targetReads.organisation_department).toEqual({ status: "unavailable" });
    expect(props.targetReads.person).toEqual({ status: "unavailable" });
    expect(JSON.stringify(props.targetReads)).not.toContain("Private");
  });

  it("keeps target search permission independent of preloaded directory read errors", () => {
    expect(projectWfhPolicyOverridesProps(input({ policies: {
      authorized: true, result: { policies: [], readError: "PREREQUISITE_PERMISSION_REQUIRED" },
    } })).policyRead.status).toBe("unavailable");
    expect(projectWfhPolicyOverridesProps(input({ targets: {
      ...input().targets,
      office: { authorized: true, result: { offices: [], readError: "PERMISSION_DENIED" } },
    } })).targetReads.office).toEqual({ status: "ready" });
    expect(projectWfhPolicyOverridesProps(input({ policies: {
      authorized: true, result: { policies: [], readError: "REQUEST_FAILED" }, issue: { message: "Policy read failed." },
    } })).policyRead).toEqual({ status: "error", policies: [], error: "Policy read failed." });
    expect(projectWfhPolicyOverridesProps(input({ policies: {
      authorized: true, result: { policies: [{ ...policy, effectiveOn: "2026-02-30" }] },
    } })).policyRead.status).toBe("error");
    expect(projectWfhPolicyOverridesProps(input({ targets: {
      ...input().targets,
      person: { authorized: true, result: { people: [{ id: "private-person", displayName: 7 }] } },
    } })).targetReads.person).toEqual({ status: "ready" });
    expect(JSON.stringify(projectWfhPolicyOverridesProps(input()))).not.toContain("jordan@example.test");
  });

  it("preserves the host create callback without exposing host data", () => {
    const onCreate = async () => {};
    expect(projectWfhPolicyOverridesProps(input({ onCreate })).onCreate).toBe(onCreate);
  });
});
