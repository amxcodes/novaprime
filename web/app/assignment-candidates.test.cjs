const assert = require("node:assert/strict");
const { test } = require("node:test");

async function loadProjector() {
  return import("./assignment-candidates.js");
}

test("candidate API rows are projected to labeled feature options", async () => {
  const { projectAssignmentCandidateRead } = await loadProjector();

  assert.deepEqual(projectAssignmentCandidateRead({
    reviewers: [{ id: "reviewer-1", display_name: " Aman Verma " }],
    handoverTargets: [{ id: "teammate-1", display_name: "Mira Rao" }],
  }), {
    reviewers: [{ id: "reviewer-1", displayName: "Aman Verma" }],
    handoverTargets: [{ id: "teammate-1", displayName: "Mira Rao" }],
  });
});

test("malformed rows fail closed while the read error remains visible", async () => {
  const { projectAssignmentCandidateRead } = await loadProjector();

  assert.deepEqual(projectAssignmentCandidateRead({
    reviewers: [{ id: "reviewer-1", display_name: " " }, null, { id: 4, display_name: "Invalid ID" }],
    handoverTargets: "invalid",
    readError: "REQUEST_FAILED",
  }), {
    reviewers: [],
    handoverTargets: [],
    readError: "REQUEST_FAILED",
  });
});
