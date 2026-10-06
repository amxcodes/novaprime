const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { createWorkTimelineCorrectionAssignmentSearch } = require("./work-timeline-actions-route.ts");
const assignmentId = "00000000-0000-4000-8000-000000000001";

function createServices(overrides = {}) {
  const calls = [];
  const services = {
    target: {},
    canAdjustTimeline: () => true,
    captureCommandContext: () => ({ page: "work" }),
    isCurrentCommand: () => true,
    api: async (path, options) => {
      calls.push({ path, options });
      return { assignments: [{ assignmentId, title: "Prepare report" }], hasMore: false, limit: 30 };
    },
    requestOptions: (method) => ({ method }),
    recoverProtectedCommandFailure: () => false,
    adminCommandUiError: (message) => new Error(message),
    ...overrides,
  };
  return { services, calls };
}

test("timeline correction source search is bounded, GET-only, and independent of My Work filters", async () => {
  const { services, calls } = createServices();
  const search = createWorkTimelineCorrectionAssignmentSearch(services);
  assert.deepEqual(await search("  Report %_  "), [{ assignmentId, title: "Prepare report" }]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/work/timeline-adjustments/assignments?q=Report%20%25_");
  assert.deepEqual(calls[0].options, { method: "GET" });
  assert.doesNotMatch(calls[0].path, /(?:status|due|cursor|limit)=/);
});

test("search fails closed when current permission or page identity is no longer valid", async () => {
  let apiCalls = 0;
  const noPermission = createWorkTimelineCorrectionAssignmentSearch(createServices({
    canAdjustTimeline: () => false,
    api: async () => { apiCalls += 1; return {}; },
  }).services);
  await assert.rejects(() => noPermission("report"), /access changed/);
  assert.equal(apiCalls, 0);

  const stalePage = createWorkTimelineCorrectionAssignmentSearch(createServices({
    isCurrentCommand: () => false,
    api: async () => { apiCalls += 1; return {}; },
  }).services);
  await assert.rejects(() => stalePage("report"), /access changed/);
  assert.equal(apiCalls, 0);
});

test("search rejects oversized or malformed server responses instead of exposing fallback options", async () => {
  const malformed = createWorkTimelineCorrectionAssignmentSearch(createServices({
    api: async () => ({ assignments: [{ assignmentId: "bad-id", title: "Prepare report" }], limit: 30 }),
  }).services);
  await assert.rejects(() => malformed("report"), /invalid response/i);

  const overLimit = createWorkTimelineCorrectionAssignmentSearch(createServices({
    api: async () => ({
      assignments: Array.from({ length: 31 }, (_, index) => ({
        assignmentId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title: `Task ${index}`,
      })),
      limit: 30,
    }),
  }).services);
  await assert.rejects(() => overLimit("task"), /invalid response/i);
});

test("server search failures remain visible to the remote select for its retry state", async () => {
  const failure = new Error("server unavailable");
  let recovered = 0;
  const search = createWorkTimelineCorrectionAssignmentSearch(createServices({
    api: async () => { throw failure; },
    recoverProtectedCommandFailure: () => { recovered += 1; return false; },
  }).services);
  await assert.rejects(() => search("report"), (error) => error === failure);
  assert.equal(recovered, 1);
});
