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

const { projectAccountIdentity } = require("./projection.ts");

test("identity projection exposes only display identity and verification status", () => {
  const result = projectAccountIdentity({
    name: "  Aman  ",
    email: "aman@example.test",
    emailVerified: false,
    id: "private-user-id",
    password: "never project",
    accessToken: "never project",
  });
  assert.deepEqual(result, { name: "Aman", email: "aman@example.test", emailVerified: false });
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(JSON.stringify(result), /private-user-id|never project/);
});

test("invalid or incomplete identity values do not enter the UI projection", () => {
  assert.equal(projectAccountIdentity(null), null);
  assert.equal(projectAccountIdentity({ email: "", emailVerified: false }), null);
  assert.equal(projectAccountIdentity({ email: "aman@example.test", emailVerified: "false" }), null);
});
