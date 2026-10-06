const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

const filename = require.resolve("./owner-transfer-route.js");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const compiled = { exports: {} };
new Function("module", "exports", output)(compiled, compiled.exports);
const { projectOwnerTransferRead } = compiled.exports;

test("owner choices exist only for the server-reported Super Admin", () => {
  assert.equal(projectOwnerTransferRead({
    actorGrants: { isSuperAdmin: false },
    peopleRead: { people: [] },
    onTransfer() {},
  }), null);
});

test("the Admin snapshot provides only picker readiness; the browser never filters its people list", () => {
  const read = projectOwnerTransferRead({
    actorGrants: { actorPersonId: "current-owner", isSuperAdmin: true },
    peopleRead: { people: [
      { id: "current-owner", status: "active", displayName: "Current owner" },
      { id: "active-person", status: "active", displayName: "Aman Verma" },
      { id: "notice-person", status: "notice", email: "notice@example.com" },
      { id: "frozen-person", status: "frozen", displayName: "Frozen person" },
      { id: 2, status: "active", displayName: "Invalid identifier" },
    ] },
    onTransfer: () => assert.fail("A browser-projected choice must not issue an owner transfer"),
  });

  assert.deepEqual(read, { status: "ready", choices: [] });
});

test("a legacy roster read does not gate the dedicated owner-search capability", () => {
  const actorGrants = { isSuperAdmin: true };
  const onTransfer = () => {};
  for (const peopleRead of [
    { readState: "not-requested" },
    { readError: "PERMISSION_DENIED" },
    { readError: "REQUEST_FAILED" },
    { people: "not-a-list" },
  ]) {
    assert.deepEqual(projectOwnerTransferRead({ actorGrants, onTransfer, peopleRead }), {
      status: "ready",
      choices: [],
    });
  }
});
