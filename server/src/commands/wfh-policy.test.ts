import { expect, test } from "bun:test";
import { wfhPolicyInput } from "./wfh-policy";

const officeId = "11111111-1111-4111-8111-111111111111";

test("accepts an effective-dated office WFH override", () => {
  expect(wfhPolicyInput({
    targetType: "office",
    targetId: officeId,
    allowed: false,
    effectiveOn: "2026-09-21",
    reason: "Office policy",
  })).toEqual({
    targetType: "office",
    targetId: officeId,
    allowed: false,
    effectiveOn: "2026-09-21",
    reason: "Office policy",
  });
});

test("rejects invalid targets and reverse effective ranges", () => {
  expect(wfhPolicyInput({
    targetType: "team",
    targetId: officeId,
    allowed: true,
    effectiveOn: "2026-09-21",
  })).toBeUndefined();
  expect(wfhPolicyInput({
    targetType: "person",
    targetId: officeId,
    allowed: true,
    effectiveOn: "2026-09-22",
    effectiveUntil: "2026-09-21",
  })).toBeUndefined();
});
