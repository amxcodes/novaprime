import { describe, expect, test } from "bun:test";
import { projectTaskCatalogProposal } from "./task-catalog.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const otherPersonId = "22222222-2222-4222-8222-222222222222";

function proposal(overrides: Partial<Parameters<typeof projectTaskCatalogProposal>[0]> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    catalog_entry_id: null,
    proposed_by_person_id: otherPersonId,
    action: "create",
    expected_revision: null,
    title: "Prepare delivery brief",
    description: null,
    priority: "normal",
    reason: "Make the recurring work consistent.",
    status: "pending",
    created_at: new Date("2026-10-02T09:00:00.000Z"),
    reviewed_at: null,
    review_note: null,
    proposer_name: "Colleague",
    reviewer_name: null,
    ...overrides,
  };
}

describe("task-catalog proposal response projection", () => {
  test("exposes review eligibility only for another person's pending proposal with the review grant", () => {
    const eligible = projectTaskCatalogProposal(proposal(), actorId, true);
    expect(eligible.canReview).toBe(true);
    expect(eligible).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Prepare delivery brief",
      status: "pending",
    });
    expect(eligible).not.toHaveProperty("proposed_by_person_id");

    expect(projectTaskCatalogProposal(proposal(), actorId, false).canReview).toBe(false);
    expect(projectTaskCatalogProposal(proposal({ proposed_by_person_id: actorId }), actorId, true).canReview).toBe(false);
    expect(projectTaskCatalogProposal(proposal({ status: "approved" }), actorId, true).canReview).toBe(false);
  });
});
