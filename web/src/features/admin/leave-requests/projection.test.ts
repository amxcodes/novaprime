import { describe, expect, it } from "bun:test";
import { projectLeaveRequestsProps } from "./projection";
import type { LeaveRequestsProjectionInput } from "./projection";

const request = {
  id: "leave-1",
  personId: "private-person-id",
  leaveType: "Annual",
  status: "pending",
  startDate: "2026-10-12",
  endDate: "2026-10-14",
  reason: "Family time",
  hasConflict: false,
  canReview: true,
  canResolveConflict: false,
  reviewReason: "private history",
  internal: { secret: "private" },
};

function input(overrides: Partial<LeaveRequestsProjectionInput> = {}): LeaveRequestsProjectionInput {
  return {
    result: { requests: [request] },
    focusRequestId: request.id,
    actions: { status: "idle" },
    onReview: async () => {},
    onResolveConflict: async () => {},
    ...overrides,
  };
}

describe("Leave Review projection", () => {
  it("passes an allowlisted summary, the notification target, and only server eligibility hints", () => {
    const props = projectLeaveRequestsProps(input());
    expect(props.read).toEqual({ status: "ready", requests: [{
      id: "leave-1",
      leaveType: "Annual",
      status: "pending",
      startDate: "2026-10-12",
      endDate: "2026-10-14",
      reason: "Family time",
      hasConflict: false,
      canReview: true,
      canResolveConflict: false,
    }] });
    expect(props.focusRequestId).toBe("leave-1");
    expect(JSON.stringify(props)).not.toContain("private");
  });

  it("requires conflict, review, and explicit attendance-recovery server hints together", () => {
    const base = { ...request, hasConflict: true, canReview: true, canResolveConflict: true };
    const allowed = projectLeaveRequestsProps(input({ result: { requests: [base] } }));
    expect(allowed.read).toMatchObject({ status: "ready", requests: [{ canResolveConflict: true }] });

    for (const row of [
      { ...base, hasConflict: false },
      { ...base, canReview: false },
      { ...base, canResolveConflict: false },
    ]) {
      const projected = projectLeaveRequestsProps(input({ result: { requests: [row] } }));
      expect(projected.read).toMatchObject({ status: "ready", requests: [{ canResolveConflict: false }] });
    }
  });

  it("keeps denied/error/empty and malformed reads distinct", () => {
    expect(projectLeaveRequestsProps(input({ failure: { status: "unavailable", message: "Review scope unavailable." } })).read)
      .toEqual({ status: "unavailable", message: "Review scope unavailable." });
    expect(projectLeaveRequestsProps(input({ failure: { status: "error", message: "Queue failed." } })).read)
      .toEqual({ status: "error", message: "Queue failed." });
    expect(projectLeaveRequestsProps(input({ result: { requests: [] } })).read)
      .toEqual({ status: "ready", requests: [] });
    expect(projectLeaveRequestsProps(input({ result: { requests: [{ ...request, hasConflict: "yes" }] } })).read)
      .toMatchObject({ status: "error", message: expect.stringContaining("response could not be read") });
  });
});
