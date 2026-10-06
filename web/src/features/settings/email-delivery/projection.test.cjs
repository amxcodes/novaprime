const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { projectEmailConnection, projectSupportedEmailProviders } = require("./projection.ts");

test("email connection projection exposes only display metadata and row-bound callbacks", () => {
  const actions = {
    onTest: async () => {},
    onActivate: async () => {},
    onDeactivate: async () => {},
    onConnectGoogle: async () => {},
  };
  const projected = projectEmailConnection({
    id: "private-connection-id",
    name: "Primary mail",
    provider: "resend",
    senderEmail: "people@example.test",
    replyToEmail: "help@example.test",
    isActive: false,
    lastTestedAt: "2026-10-02T10:00:00.000Z",
    lastTestErrorCode: null,
    credentials: { apiKey: "never-render-this" },
    credentials_ciphertext: "ciphertext-never-render-this",
    oauthAccessToken: "token-never-render-this",
  }, true, actions);

  assert.deepEqual(projected, {
    name: "Primary mail",
    provider: "resend",
    senderEmail: "people@example.test",
    replyToEmail: "help@example.test",
    isActive: false,
    supported: true,
    lastTestedAt: "2026-10-02T10:00:00.000Z",
    lastTestStatus: "passed",
    ...actions,
  });
  assert.equal(Object.hasOwn(projected, "id"), false);
  assert.equal(Object.hasOwn(projected, "credentials"), false);
  assert.equal(JSON.stringify(projected).includes("never-render-this"), false);
});

test("projection validates required display fields and maps test outcome without raw error codes", () => {
  const actions = { onTest: async () => {}, onActivate: async () => {}, onDeactivate: async () => {} };
  const failed = projectEmailConnection({
    id: "id",
    name: "SMTP",
    provider: "smtp",
    senderEmail: "sender@example.test",
    isActive: true,
    lastTestedAt: "2026-10-02T10:00:00.000Z",
    lastTestErrorCode: "EMAIL_PROVIDER_DELIVERY_FAILED",
  }, false, actions);

  assert.equal(failed.lastTestStatus, "failed");
  assert.equal(failed.supported, false);
  assert.equal(Object.hasOwn(failed, "lastTestErrorCode"), false);
  assert.equal(projectEmailConnection({ name: "Missing provider", senderEmail: "x@example.test", isActive: false }, true, actions), null);
  assert.equal(projectEmailConnection({ name: "Unknown provider", provider: "future", senderEmail: "x@example.test", isActive: false }, true, actions), null);
});

test("runtime provider projection rejects unknown values and returns stable known ordering", () => {
  assert.deepEqual(projectSupportedEmailProviders(["resend", "future", "smtp", "smtp", null]), ["smtp", "resend"]);
  assert.deepEqual(projectSupportedEmailProviders("smtp"), []);
});
