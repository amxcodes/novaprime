const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { projectAuthHandoff, projectAuthHandoffList } = require("./projection.ts");
const id = "00000000-0000-4000-8000-000000000001";
const source = {
  id,
  purpose: "invitation",
  targetPersonId: "private-person-id",
  targetDisplayName: "Taylor Example",
  targetEmail: "taylor@example.test",
  reason: "New starter",
  expiresAt: "2026-10-04T12:30:00.000Z",
  url: "https://private.example.test/secret-token",
  session: { token: "private-session" },
};

test("projection contains display fields, an opaque view key, and closure only, omitting server identifiers and secrets", () => {
  const action = async () => "https://private.example.test/secret-token";
  const projected = projectAuthHandoff(source, ["invitation"], action);
  assert.deepEqual(Object.keys(projected).sort(), ["expiresAt", "onReveal", "purpose", "reason", "revealBlocked", "targetDisplayName", "targetEmail", "viewKey"].sort());
  assert.equal(projected.onReveal, action);
  assert.doesNotMatch(JSON.stringify(projected), /private-person-id|secret-token|private-session|00000000-0000/);
  assert.match(projected.viewKey, /^handoff-view-[a-z0-9-]+$/i);
});

test("projection rejects rows outside the role's purpose and malformed data", () => {
  let revealFactoryCalls = 0;
  assert.equal(projectAuthHandoff({ ...source, purpose: "password_reset" }, ["invitation"], async () => "url"), null);
  assert.equal(projectAuthHandoff({ ...source, expiresAt: "no date" }, ["invitation"], async () => "url"), null);
  assert.equal(projectAuthHandoffList({ handoffs: [{ ...source, purpose: "verification" }] }, ["invitation"], () => {
    revealFactoryCalls += 1;
    return async () => "url";
  }).length, 0);
  assert.equal(revealFactoryCalls, 0);
  assert.equal(projectAuthHandoffList({ handoffs: [source] }, ["invitation"], (candidateId) => {
    assert.equal(candidateId, id);
    return async () => "url";
  })?.length, 1);
  assert.equal(projectAuthHandoffList({ handoffs: [source] }, ["invitation"], () => async () => "url", () => true)?.[0].revealBlocked, true);
  assert.equal(projectAuthHandoffList({ handoffs: [source, null] }, ["invitation"], () => async () => "url"), null);
  assert.equal(projectAuthHandoffList({ handoffs: [{ ...source, id: "not-an-id" }] }, ["invitation"], () => async () => "url"), null);
});

test("list projection rejects unknown purpose values instead of widening visibility", () => {
  assert.equal(projectAuthHandoffList({ handoffs: [{ ...source, purpose: "other" }] }, ["invitation", "verification", "password_reset"], () => async () => "url"), null);
});

test("reprojecting a reordered or reduced list creates fresh, unique card identities", () => {
  const second = { ...source, id: "00000000-0000-4000-8000-000000000002", targetDisplayName: "Jordan Example", targetEmail: "jordan@example.test" };
  const project = (handoffs) => projectAuthHandoffList({ handoffs }, ["invitation"], () => async () => "url");
  const before = project([source, second]);
  const after = project([second]);
  const oldKeys = new Set(before.map((handoff) => handoff.viewKey));
  assert.equal(new Set(before.map((handoff) => handoff.viewKey)).size, 2);
  assert.equal(after.length, 1);
  assert.equal(oldKeys.has(after[0].viewKey), false);
  assert.equal(after[0].targetDisplayName, "Jordan Example");
});
