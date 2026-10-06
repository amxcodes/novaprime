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

const { AccountSessionFreshnessError } = require("./contracts.ts");
const { createAccountSessionController } = require("./session-controller.ts");

const rawSessions = [
  {
    id: "current",
    token: "current-secret-token",
    ipAddress: "192.0.2.1",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    createdAt: "2026-10-06T08:00:00.000Z",
    updatedAt: "2026-10-06T09:00:00.000Z",
  },
  {
    id: "other",
    token: "other-secret-token",
    ipAddress: "198.51.100.2",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
    createdAt: "2026-10-05T08:00:00.000Z",
    updatedAt: "2026-10-06T08:30:00.000Z",
  },
];

test("controller projects safe rows and keeps both session tokens inside its private request adapter", async () => {
  const calls = [];
  const controller = createAccountSessionController(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path.endsWith("list-sessions")) return rawSessions;
    if (path.endsWith("get-session")) return { session: { id: "current", token: "current-secret-token" } };
    return { status: true };
  });

  const sessions = await controller.load();
  assert.deepEqual(sessions.map(({ id, device, isCurrent }) => ({ id, device, isCurrent })), [
    { id: "current", device: "Safari on macOS", isCurrent: true },
    { id: "other", device: "Firefox on Linux", isCurrent: false },
  ]);
  for (const secret of ["current-secret-token", "other-secret-token", "192.0.2.1", "198.51.100.2", "Mozilla/5.0"]) {
    assert.equal(JSON.stringify(sessions).includes(secret), false);
  }
  assert.deepEqual(Object.keys(controller).sort(), ["load", "revoke", "revokeOthers"]);
});

test("individual and bulk revocation re-check session freshness before posting", async () => {
  const calls = [];
  let fresh = true;
  const controller = createAccountSessionController(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path.endsWith("list-sessions")) {
      if (!fresh) {
        const error = new Error("SESSION_NOT_FRESH");
        error.code = "SESSION_NOT_FRESH";
        throw error;
      }
      return rawSessions;
    }
    if (path.endsWith("get-session")) return { session: { id: "current" } };
    return { status: true };
  });

  await controller.load();
  const beforeRevoke = calls.length;
  await controller.revoke("other");
  assert.equal(calls[beforeRevoke].path, "/api/auth/list-sessions");
  assert.equal(calls.findLast((call) => call.path.endsWith("revoke-session")).body.token, "other-secret-token");

  const beforeBulk = calls.length;
  await controller.revokeOthers();
  assert.equal(calls[beforeBulk].path, "/api/auth/list-sessions");
  assert.ok(calls.some((call) => call.path.endsWith("revoke-other-sessions")));

  fresh = false;
  await assert.rejects(controller.revoke("other"), AccountSessionFreshnessError);
  await assert.rejects(controller.revokeOthers(), AccountSessionFreshnessError);
  assert.equal(calls.filter((call) => call.path.endsWith("revoke-session") || call.path.endsWith("revoke-other-sessions")).length, 2);
});

test("current session cannot be revoked through an individual action", async () => {
  const controller = createAccountSessionController(async (path) => {
    if (path.endsWith("list-sessions")) return rawSessions;
    if (path.endsWith("get-session")) return { session: { id: "current" } };
    throw new Error("Unexpected revoke request.");
  });
  await controller.load();
  await assert.rejects(controller.revoke("current"), /current session cannot be signed out/i);
});
