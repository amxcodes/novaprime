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

test("only other active or notice people are projected and IDs stay in host closures", () => {
  const submitted = [];
  const read = projectOwnerTransferRead({
    actorGrants: { actorPersonId: "current-owner", isSuperAdmin: true },
    peopleRead: { people: [
      { id: "current-owner", status: "active", displayName: "Current owner" },
      { id: "active-person", status: "active", displayName: "Aman Verma" },
      { id: "notice-person", status: "notice", email: "notice@example.com" },
      { id: "frozen-person", status: "frozen", displayName: "Frozen person" },
      { id: 2, status: "active", displayName: "Invalid identifier" },
    ] },
    onTransfer: (personId) => submitted.push(personId),
  });

  assert.deepEqual(read.choices.map(({ label }) => label), ["Aman Verma", "notice@example.com"]);
  assert.ok(read.choices.every((choice) => !Object.hasOwn(choice, "id")));
  read.choices[1].transfer();
  assert.deepEqual(submitted, ["notice-person"]);
});

test("skipped, denied, and failed people reads stay distinct and fail closed", () => {
  const actorGrants = { isSuperAdmin: true };
  const onTransfer = () => {};
  assert.deepEqual(projectOwnerTransferRead({ actorGrants, onTransfer, peopleRead: { readState: "not-requested" } }), {
    status: "unavailable",
    message: "Your current grants do not include the people list needed to choose a new owner.",
  });
  assert.equal(projectOwnerTransferRead({ actorGrants, onTransfer, peopleRead: { readError: "PERMISSION_DENIED" } }).status, "unavailable");
  assert.equal(projectOwnerTransferRead({ actorGrants, onTransfer, peopleRead: { readError: "REQUEST_FAILED" } }).status, "error");
  assert.equal(projectOwnerTransferRead({ actorGrants, onTransfer, peopleRead: { people: "not-a-list" } }).status, "error");
});
