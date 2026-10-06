const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

async function loadStore() {
  return import("./review-feedback-drafts.js");
}

test("review feedback drafts are discarded when the same actor's effective review access changes", async () => {
  const { createReviewFeedbackDraftStore } = await loadStore();
  const store = createReviewFeedbackDraftStore();
  const draft = { sourceReviewCycleId: "cycle-1", feedback: "Please clarify." };

  store.prepare("person-1", '["organisation"]');
  store.save("person-1", "assignment-1", draft, "task-1");
  store.prepare("person-1", '["client:client-2"]');

  assert.equal(store.read("person-1", "assignment-1"), undefined);
  store.prepare("person-1", '["organisation"]');
  assert.equal(store.read("person-1", "assignment-1"), undefined);
});

test("review feedback drafts are inaccessible to a different actor and clear on identity recovery", async () => {
  const { createReviewFeedbackDraftStore } = await loadStore();
  const store = createReviewFeedbackDraftStore();
  const draft = { sourceReviewCycleId: "cycle-1", feedback: "Please clarify." };

  store.prepare("person-1", '["organisation"]');
  store.save("person-1", "assignment-1", draft, "task-1");
  assert.equal(store.read("person-2", "assignment-1"), undefined);
  store.clear();
  store.prepare("person-1", '["organisation"]');

  assert.equal(store.read("person-1", "assignment-1"), undefined);
});

test("successful queue reads retain only visible assignments and focused task denial clears its notes", async () => {
  const { createReviewFeedbackDraftStore, reconcileReviewFeedbackDraftAccess } = await loadStore();
  const store = createReviewFeedbackDraftStore();
  const draft = { sourceReviewCycleId: "cycle-1", feedback: "Please clarify." };

  store.prepare("person-1", '["organisation"]');
  store.save("person-1", "assignment-1", draft, "task-1");
  store.save("person-1", "assignment-2", draft, "task-2");
  reconcileReviewFeedbackDraftAccess(store, "person-1", {
    reviewsResult: { reviews: [{ assignmentId: "assignment-1", taskId: "task-1" }] },
  });
  assert.equal(store.read("person-1", "assignment-2"), undefined);

  reconcileReviewFeedbackDraftAccess(store, "person-1", {
    reviewsResult: { reviews: [] },
    reviewTarget: { taskId: "task-1" },
    hasReviewRoute: true,
  });
  assert.equal(store.read("person-1", "assignment-1"), undefined);
});

test("a denied review read clears notes and requests a permission refresh without restoring the old note", async () => {
  const { createReviewFeedbackDraftStore, reconcileReviewFeedbackDraftAccess } = await loadStore();
  const store = createReviewFeedbackDraftStore();
  const draft = { sourceReviewCycleId: "cycle-1", feedback: "Please clarify." };

  store.prepare("person-1", '["organisation"]');
  store.save("person-1", "assignment-1", draft, "task-1");
  const result = reconcileReviewFeedbackDraftAccess(store, "person-1", {
    reviewsResult: { readError: "PERMISSION_DENIED" },
  });
  assert.deepEqual(result, { refreshPermissions: true });

  store.prepare("person-1", '["organisation"]');
  assert.equal(store.read("person-1", "assignment-1"), undefined);
});

test("Work host clears review drafts on identity reset and reconciles the live queue before projection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(source, /function clearIdentityScopedState\(\) \{\s*clearAllReviewFeedbackDrafts\(\)/);
  assert.match(source, /reconcileReviewDraftAccess\(reviewFeedbackDrafts, actorId,[\s\S]*?if \(result\.refreshPermissions\) refreshReviewPermissionsAfterDeniedRead\(\)/);
  assert.match(source, /saveReviewFeedbackDraft\(assignmentId, draft, taskId\)/);
  assert.match(source, /prepareReviewFeedbackDraftsForActor\(grants\)/);
});
