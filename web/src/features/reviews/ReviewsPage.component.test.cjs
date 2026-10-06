const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

const defaultJsLoader = require.extensions[".js"];
require.extensions[".js"] = (module, filename) => {
  if (path.basename(filename) !== "review-actions.js") return defaultJsLoader(module, filename);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { focusReviewCard, ReviewsPage } = require("./ReviewsPage.tsx");
const { REVIEW_FEEDBACK_LIMIT, validateReviewFeedback } = require("./review-feedback.ts");

const callbacks = {
  onOpenContext: () => {},
  onApprove: async () => {},
  onRequestChanges: async () => {},
  onDraftChange: () => {},
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(ReviewsPage, {
    queue: { status: "empty" },
    ...callbacks,
    ...props,
  }));
}

test("queue exposes distinct loading, denied, error, and empty states", () => {
  const loading = render({ queue: { status: "loading" } });
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading pending reviews/);

  const denied = render({ queue: { status: "denied", message: "Read grant unavailable." } });
  assert.match(denied, /Pending reviews are unavailable/);
  assert.match(denied, /Read grant unavailable\./);

  const error = render({ queue: { status: "error", message: "Try again later." } });
  assert.match(error, /Pending reviews could not be loaded/);
  assert.match(error, /Try again later\./);

  const empty = render({ queue: { status: "empty" } });
  assert.match(empty, /No pending reviews/);
});

test("a row without a decision capability has context only", () => {
  const markup = render({
    queue: { status: "ready", requestLimit: 100, reviews: [{
      assignmentId: "assignment-safe-id",
      title: "Prepare the delivery brief",
      reviewCycleId: "cycle-1",
      cycleNumber: 1,
      submittedAt: "2026-10-02T10:00:00.000Z",
      canDecide: false,
      rawDetails: "secret payload is ignored",
    }] },
  });

  assert.match(markup, /Prepare the delivery brief/);
  assert.match(markup, /Review context/);
  assert.doesNotMatch(markup, />Approve</);
  assert.doesNotMatch(markup, />Request changes</);
  assert.match(markup, /1 loaded · this request returns up to 100 pending reviews/);
  assert.doesNotMatch(markup, /secret payload/);
});

test("a decidable row keeps its host draft and distinguishes approval from change feedback", () => {
  const markup = render({
    queue: { status: "ready", requestLimit: 100, reviews: [{
      assignmentId: "assignment-1",
      title: "Prepare the delivery brief",
      reviewCycleId: "cycle-2",
      cycleNumber: 2,
      submittedAt: "2026-10-02T10:00:00.000Z",
      canDecide: true,
      draft: {
        sourceReviewCycleId: "cycle-2",
        acknowledgedReviewCycleId: null,
        feedback: "Add the source document.",
      },
    }] },
  });

  assert.match(markup, />Approve</);
  assert.match(markup, />Request changes</);
  assert.match(markup, /<textarea[^>]*>Add the source document\.<\/textarea>/);
  assert.match(markup, /hidden=""/);
  assert.match(markup, /What needs to change\?/);
  assert.match(markup, /Add the source document\./);
  assert.match(markup, /2000 characters/);
  assert.match(markup, /Be specific about the update needed/);
  assert.match(markup, /noValidate/);
  assert.doesNotMatch(markup, /<select/);
});

test("feedback is trimmed, nonblank, bounded, and stale-cycle acknowledgement is mandatory", () => {
  assert.deepEqual(validateReviewFeedback("  Add the source.  ", {
    staleDraft: false,
    confirmedCurrentCycle: false,
  }), { ok: true, feedback: "Add the source." });
  assert.deepEqual(validateReviewFeedback("  \n ", {
    staleDraft: false,
    confirmedCurrentCycle: false,
  }), { ok: false, reason: "required" });
  assert.deepEqual(validateReviewFeedback("x".repeat(REVIEW_FEEDBACK_LIMIT + 1), {
    staleDraft: false,
    confirmedCurrentCycle: false,
  }), { ok: false, reason: "too_long" });
  assert.deepEqual(validateReviewFeedback("Still applies", {
    staleDraft: true,
    confirmedCurrentCycle: false,
  }), { ok: false, reason: "stale_cycle_confirmation" });
  assert.deepEqual(validateReviewFeedback("Still applies", {
    staleDraft: true,
    confirmedCurrentCycle: true,
  }), { ok: true, feedback: "Still applies" });
});

test("a draft from an older cycle is visibly preserved and requires explicit confirmation", () => {
  const markup = render({
    queue: { status: "ready", requestLimit: 100, reviews: [{
      assignmentId: "assignment-1",
      title: "Prepare the delivery brief",
      reviewCycleId: "cycle-3",
      cycleNumber: 3,
      submittedAt: "2026-10-02T10:00:00.000Z",
      canDecide: true,
      draft: {
        sourceReviewCycleId: "cycle-2",
        acknowledgedReviewCycleId: null,
        feedback: "Keep this note for the new cycle",
      },
    }] },
  });

  assert.match(markup, /A newer review cycle is open/);
  assert.match(markup, /<textarea[^>]*>Keep this note for the new cycle<\/textarea>/);
  assert.match(markup, /I reviewed this newer submission and confirmed that this feedback still applies\./);
  assert.match(markup, /aria-required="true"/);
  assert.match(markup, /name="confirmCurrentCycle"/);
});

test("review context shows authorized summary, newest-first history, and bounded-history copy", () => {
  const markup = render({
    context: { status: "ready", detail: {
      review: {
        assigneeName: "Aman",
        taskTitle: "Prepare the delivery brief",
        taskDescription: "Include the approved sources.",
        taskStatus: "awaiting_review",
        priority: "high",
        dueDate: "2026-10-03",
        clientName: "Northwind",
        workstreamName: "Research",
        groupName: "Editorial",
        submittedAt: "2026-10-02T10:00:00.000Z",
        internalToken: "not-forwarded-to-rendering",
      },
      history: [
        { reviewCycleId: "cycle-1", cycleNumber: 1, decision: "changes_requested", submittedAt: "2026-09-28T10:00:00.000Z", decidedAt: "2026-09-29T10:00:00.000Z", feedback: "Add the source.", isCurrent: false },
        { reviewCycleId: "cycle-2", cycleNumber: 2, decision: null, submittedAt: "2026-10-02T10:00:00.000Z", decidedAt: null, feedback: null, isCurrent: true },
      ],
      historyTruncated: true,
    } },
  });

  assert.match(markup, /Aman/);
  assert.match(markup, /Northwind · Research · Editorial/);
  assert.match(markup, /awaiting review/);
  assert.match(markup, /Include the approved sources\./);
  assert.match(markup, /This history is bounded/);
  assert.match(markup, /Showing the 2 most recent cycles/);
  assert.ok(markup.indexOf("Cycle 2 · current") < markup.indexOf("Cycle 1"));
  assert.doesNotMatch(markup, /not-forwarded-to-rendering/);
});

test("review context keeps denied and failed reads separate from empty queue state", () => {
  const denied = render({ context: { status: "denied", message: "Context is restricted." } });
  assert.match(denied, /Review context is unavailable/);
  assert.match(denied, /Context is restricted\./);
  assert.match(denied, /Pending reviews/);

  const error = render({ context: { status: "error", message: "Context did not load." } });
  assert.match(error, /Review context could not be loaded/);
  assert.match(error, /Context did not load\./);
});

test("an optional assignment focus request scrolls to and focuses its labeled card", () => {
  const calls = [];
  const target = {
    scrollIntoView: (options) => calls.push(["scroll", options]),
    focus: (options) => calls.push(["focus", options]),
  };
  focusReviewCard(target);
  focusReviewCard(null);

  assert.deepEqual(calls, [
    ["scroll", { block: "nearest" }],
    ["focus", { preventScroll: true }],
  ]);
  const contracts = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "ReviewsPage.tsx"), "utf8");
  assert.match(contracts, /focusAssignmentId\?: string/);
  assert.match(source, /focus=\{props\.focusAssignmentId === review\.assignmentId\}/);
  assert.match(source, /tabIndex=\{-1\}[\s\S]*aria-labelledby=/);
});

test("contracts and styles keep authority in the host and presentation in this feature", () => {
  const contracts = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "ReviewsPage.module.css"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "ReviewsPage.tsx"), "utf8");
  assert.match(contracts, /canDecide: boolean/);
  assert.match(contracts, /onApprove:/);
  assert.match(contracts, /onRequestChanges:/);
  assert.match(contracts, /onDraftChange:/);
  assert.doesNotMatch(contracts, /fetch\(|\/api\//);
  assert.doesNotMatch(source, /fetch\(|\/api\//);
  assert.match(styles, /@container reviews \(max-width/);
  assert.match(styles, /@container reviews \(min-width: 40rem\)/);
  assert.match(styles, /@container reviews \(min-width: 64rem\)/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
});
