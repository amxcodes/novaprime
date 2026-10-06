import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { projectWfhRequestsReviewProps } from "./projection";
import type { WfhRequestsReviewProjectionInput } from "./projection";

const request = {
  id: "wfh-1",
  startDate: "2026-10-05",
  endDate: "2026-10-06",
  reason: "Plumber visit",
  canReview: true,
  personId: "private-person-id",
  reviewerPersonId: "private-reviewer-id",
  reviewReason: "private history",
  privateData: { token: "private" },
};

function input(overrides: Partial<WfhRequestsReviewProjectionInput> = {}): WfhRequestsReviewProjectionInput {
  return {
    result: { requests: [request] },
    focusRequestId: request.id,
    onReview: async () => {},
    ...overrides,
  };
}

describe("WFH Review projection", () => {
  it("keeps read/action eligibility separate and passes only safe request fields", () => {
    const props = projectWfhRequestsReviewProps(input());
    expect(props.readEligibility).toEqual({ allowed: true });
    expect(props.actionEligibility).toEqual({ allowed: true });
    expect(props.readState).toEqual({ status: "ready", requests: [{
      id: "wfh-1",
      startDate: "2026-10-05",
      endDate: "2026-10-06",
      reason: "Plumber visit",
      canReview: true,
    }] });
    expect(props.focusRequestId).toBe("wfh-1");
    expect(JSON.stringify(props)).not.toContain("private");
  });

  it("preserves a false row-level review hint without granting actions", () => {
    const props = projectWfhRequestsReviewProps(input({ result: { requests: [{ ...request, canReview: false }] } }));
    expect(props.readState).toMatchObject({ status: "ready", requests: [{ canReview: false }] });
  });

  it("derives eligibility only for the separately grant-gated wrapper", () => {
    const props = projectWfhRequestsReviewProps(input());
    expect(props.readEligibility).toEqual({ allowed: true });
    expect(props.actionEligibility).toEqual({ allowed: true });
    const source = readFileSync(new URL("./WfhRequestsReviewSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/Lazy feature boundary for the independently grant-filtered WFH Review section/);
  });

  it("keeps unavailable/error/empty states separate and rejects malformed rows", () => {
    expect(projectWfhRequestsReviewProps(input({ failure: { status: "unavailable", message: "Review scope unavailable." } })).readState)
      .toEqual({ status: "unavailable", message: "Review scope unavailable." });
    expect(projectWfhRequestsReviewProps(input({ failure: { status: "error", message: "Queue failed." } })).readState)
      .toEqual({ status: "error", message: "Queue failed." });
    expect(projectWfhRequestsReviewProps(input({ result: { requests: [] } })).readState)
      .toEqual({ status: "ready", requests: [] });
    expect(projectWfhRequestsReviewProps(input({ result: { requests: [{ ...request, endDate: null }] } })).readState)
      .toMatchObject({ status: "error", message: expect.stringContaining("response could not be read") });
  });
});
