const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

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

const { projectWorkTaskDetail } = require("./projection.ts");

test("task detail projection strips identifiers and write revisions while preserving display-safe rows", () => {
  const projected = projectWorkTaskDetail({
    id: "task-id",
    title: "Quarterly metrics",
    dueDate: "2026-10-20",
    dueDateRevision: 9,
    billingPolicyRevision: 4,
    taskDefinition: { entryId: "definition-id", revision: 3 },
    isCorrection: true,
    correctionOf: { taskId: "source-task-id", title: "Original report" },
    client: { id: "client-id", name: "Northwind" },
    workstream: { id: "workstream-id", name: "Reporting", kind: "client" },
    group: { id: "group-id", name: "Finance" },
    department: { id: "department-id", name: "Operations" },
    assignments: [
      {
        id: "assignment-1",
        personId: "person-1",
        personName: "Aman",
        reviewerId: "reviewer-1",
        reviewerName: "Riya",
        reviewRequired: true,
        reviewBlockedReason: "missing_evidence",
        status: "in_progress",
      },
      null,
      "malformed assignment",
      {
        id: "assignment-2",
        personId: "person-2",
        personName: "Sam",
        reviewerName: null,
        reviewRequired: false,
        reviewBlockedReason: null,
        status: "submitted",
      },
    ],
  });

  assert.equal(Object.hasOwn(projected, "id"), false);
  assert.equal(Object.hasOwn(projected, "dueDateRevision"), false);
  assert.equal(projected.taskDefinitionRevision, 3);
  assert.equal(projected.billingPolicyRevision, 4);
  assert.equal(projected.correctionTitle, "Original report");
  assert.equal(Object.hasOwn(projected, "correctionOf"), false);
  assert.equal(projected.clientName, "Northwind");
  assert.equal(projected.workstreamName, "Reporting");

  assert.deepEqual(projected.assignments, [
    {
      personName: "Aman",
      reviewerName: "Riya",
      reviewRequired: true,
      reviewBlockedReason: "missing_evidence",
      status: "in_progress",
    },
    {
      personName: "Sam",
      reviewerName: null,
      reviewRequired: false,
      reviewBlockedReason: null,
      status: "submitted",
    },
  ]);

  const serialized = JSON.stringify(projected);
  for (const identifier of ["task-id", "definition-id", "source-task-id", "client-id", "workstream-id", "assignment-1", "person-1", "reviewer-1"]) {
    assert.equal(serialized.includes(identifier), false, `projection leaked ${identifier}`);
  }
});
