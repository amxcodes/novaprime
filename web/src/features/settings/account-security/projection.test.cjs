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

const { projectAccountIdentity, projectAccountSessions } = require("./projection.ts");

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

test("active-session projection keeps only safe labels, IDs, and timestamps", () => {
  const raw = [{
    id: "session-current",
    token: "secret-session-token",
    ipAddress: "192.0.2.9",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-06T10:00:00.000Z",
    userId: "private-user-id",
  }, {
    id: "missing-token",
    userAgent: "Firefox/140.0 (X11; Linux x86_64)",
    createdAt: "2026-10-05T10:00:00.000Z",
  }];
  const projected = projectAccountSessions(raw, "session-current");
  assert.deepEqual(projected, [{
    id: "session-current",
    device: "Chrome on Windows",
    lastActiveAt: "2026-10-06T10:00:00.000Z",
    isCurrent: true,
  }]);
  const serialized = JSON.stringify(projected);
  for (const secret of ["secret-session-token", "192.0.2.9", "Mozilla/5.0", "private-user-id"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("active-session projection drops malformed or undated rows and labels unknown devices safely", () => {
  const projected = projectAccountSessions([
    { id: "unknown-device", token: "secret", updatedAt: "not-a-date" },
    { id: "unknown-agent", token: "secret", createdAt: "2026-10-06T10:00:00.000Z" },
    { id: "without-token", updatedAt: "2026-10-06T10:00:00.000Z" },
  ], null);
  assert.deepEqual(projected, [{
    id: "unknown-agent",
    device: "Unknown device",
    lastActiveAt: "2026-10-06T10:00:00.000Z",
    isCurrent: false,
  }]);
});
