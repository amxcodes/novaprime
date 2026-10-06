const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { projectPublicOrigin } = require("./projection.ts");

test("projection returns only allowed origin fields and accepts an operator-approved HTTP fallback", () => {
  const result = projectPublicOrigin({
    configuredOrigin: null,
    effectiveOrigin: "http://127.0.0.1:4173",
    allowedOrigins: ["http://127.0.0.1:4173", "https://work.example.test", "https://work.example.test"],
    secret: "never project",
    id: "raw-record-id",
  });
  assert.deepEqual(result, {
    configuredOrigin: null,
    effectiveOrigin: "http://127.0.0.1:4173",
    allowedOrigins: ["http://127.0.0.1:4173", "https://work.example.test"],
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.allowedOrigins), true);
});

test("projection rejects malformed responses and configured origins outside the operator allowlist", () => {
  assert.equal(projectPublicOrigin({ allowedOrigins: [], configuredOrigin: null, effectiveOrigin: "javascript:alert(1)" }), null);
  assert.equal(projectPublicOrigin({ allowedOrigins: [], configuredOrigin: null, effectiveOrigin: "https://outside.example.test" }), null);
  assert.equal(projectPublicOrigin({ allowedOrigins: ["https://work.example.test"], configuredOrigin: "https://other.example.test", effectiveOrigin: "https://work.example.test" }), null);
  assert.equal(projectPublicOrigin({ allowedOrigins: "https://work.example.test", configuredOrigin: null, effectiveOrigin: "https://work.example.test" }), null);
});
