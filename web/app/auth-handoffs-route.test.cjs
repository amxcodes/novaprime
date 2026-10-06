const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

const adapterPath = path.join(__dirname, "auth-handoffs-route.js");
const adapterSource = fs.readFileSync(adapterPath, "utf8");
const adapterOutput = ts.transpileModule(adapterSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: adapterPath,
}).outputText;
const adapterModule = new Module(adapterPath, module);
adapterModule.filename = adapterPath;
adapterModule.paths = Module._nodeModulePaths(path.dirname(adapterPath));
adapterModule._compile(adapterOutput, adapterPath);
const { getAuthHandoffAccess, mountSettingsAuthHandoffs } = adapterModule.exports;

const handoffId = "00000000-0000-4000-8000-000000000001";
const secretUrl = "https://nova.example.test/accept-invite?token=one-time-secret";

test("access projection separates organisation permissions and bootstrap self-verification", () => {
  const read = (grants) => getAuthHandoffAccess({ actorGrants: { grants } });
  assert.deepEqual(read([{ permissionKey: "people.invite", scope: "organisation" }]).allowedPurposes, ["invitation"]);
  assert.deepEqual(read([{ permissionKey: "auth.manual_recovery", scope: "organisation" }]).allowedPurposes, ["verification", "password_reset"]);
  assert.deepEqual(read([
    { permissionKey: "people.invite", scope: "organisation" },
    { permissionKey: "auth.manual_recovery", scope: "organisation" },
  ]).allowedPurposes, ["invitation", "verification", "password_reset"]);
  assert.equal(read([{ permissionKey: "people.invite", scope: "office", officeId: "office-id" }]).canRead, false);

  const bootstrapState = {
    bootstrapToken: "private-bootstrap-token",
    bootstrapFounderEmail: "founder@example.test",
    session: { email: "Founder@example.test", emailVerified: false },
    actorGrants: { readError: "ACCOUNT_NOT_OPERATIONAL", grants: [] },
  };
  assert.deepEqual(getAuthHandoffAccess(bootstrapState), {
    bootstrap: true,
    canRead: true,
    allowedPurposes: ["verification"],
  });
  assert.equal(getAuthHandoffAccess({ ...bootstrapState, session: { ...bootstrapState.session, emailVerified: true } }).canRead, false);
  assert.equal(getAuthHandoffAccess({ ...bootstrapState, bootstrapFounderEmail: "someone-else@example.test" }).canRead, false);
});

function createFakeFeature() {
  class AuthHandoffActionError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }
  return {
    AuthHandoffs: function AuthHandoffs() {},
    AuthHandoffActionError,
    projectAuthHandoffList(value, allowedPurposes, revealForId, revealIsBlocked) {
      if (!Array.isArray(value?.handoffs)) return null;
      return value.handoffs.map((row, index) => ({
        viewKey: `handoff-view-${index}`,
        purpose: row.purpose,
        targetDisplayName: row.targetDisplayName,
        targetEmail: row.targetEmail,
        reason: row.reason,
        expiresAt: row.expiresAt,
        revealBlocked: revealIsBlocked(row.id),
        onReveal: revealForId(row.id, row.purpose),
      }));
    },
  };
}

function createHost(overrides = {}) {
  const state = {
    identityEpoch: 1,
    identityPersonId: "actor-person-id",
    session: { email: "admin@example.test", emailVerified: true },
    actorGrants: {
      actorPersonId: "actor-person-id",
      grants: [{ permissionKey: "people.invite", scope: "organisation" }],
    },
  };
  const target = { isConnected: true, replaceChildren() {} };
  const renders = [];
  const requests = [];
  const host = {
    state,
    target,
    renders,
    requests,
    loadFeature: async () => createFakeFeature(),
    mountReactIsland(_target, _Component, props) { renders.push(props); },
    requestOptions(method, body, headers) { return { method, body, headers: headers || {}, credentials: "include" }; },
    captureCommandContext() { return { actor: state.identityPersonId }; },
    isCurrentCommand() { return target.isConnected; },
    isCurrentCommandIdentity() { return target.isConnected; },
    recoverProtectedCommandFailure() { return false; },
    noticeElement(message) { return message; },
    async api(path, options) {
      requests.push({ path, options });
      if (path === "/api/auth-handoffs") return { handoffs: [{
        id: handoffId,
        purpose: "invitation",
        targetPersonId: "private-target-person-id",
        targetDisplayName: "Taylor Example",
        targetEmail: "taylor@example.test",
        reason: "Email unavailable",
        expiresAt: "2026-10-04T12:30:00.000Z",
        url: secretUrl,
      }] };
      return { handoff: { url: secretUrl } };
    },
    ...overrides,
  };
  return host;
}

test("adapter keeps IDs in host closures, uses exact session routes, and never retries reveal", async () => {
  const host = createHost();
  await mountSettingsAuthHandoffs(host.target, () => true, host);
  const ready = host.renders.at(-1);
  assert.equal(ready.readState.status, "ready");
  assert.equal(ready.readState.handoffs.length, 1);
  const row = ready.readState.handoffs[0];
  assert.deepEqual(Object.keys(row).sort(), ["expiresAt", "onReveal", "purpose", "reason", "revealBlocked", "targetDisplayName", "targetEmail", "viewKey"].sort());
  assert.doesNotMatch(JSON.stringify(row), new RegExp(`${handoffId}|private-target-person-id|one-time-secret`));
  assert.equal(host.requests[0].path, "/api/auth-handoffs");
  assert.equal(host.requests[0].options.credentials, "include");
  assert.equal(host.requests[0].options.headers["x-nova-bootstrap-token"], undefined);

  assert.equal(await row.onReveal(), secretUrl);
  assert.equal(host.requests[1].path, `/api/auth-handoffs/${handoffId}/reveal`);
  assert.equal(host.requests[1].options.method, "POST");
  assert.equal(host.requests[1].options.credentials, "include");
  assert.equal(host.renders.some((render) => render.revealPending), true);
  await assert.rejects(row.onReveal(), /no longer available/);
  assert.equal(host.requests.filter((request) => request.path.endsWith("/reveal")).length, 1);

  await host.renders.at(-1).onRetry();
  assert.equal(host.renders.at(-1).readState.handoffs[0].revealBlocked, true);
});

test("bootstrap credentials are sent only for self-verification and cleared after confirmed reveal", async () => {
  const host = createHost();
  host.state.bootstrapToken = "private-bootstrap-token";
  host.state.bootstrapFounderEmail = "admin@example.test";
  host.state.session.emailVerified = false;
  host.state.actorGrants.readError = "ACCOUNT_NOT_OPERATIONAL";
  host.state.actorGrants.grants = [];
  host.api = async (path, options) => {
    host.requests.push({ path, options });
    if (path === "/api/auth-handoffs") return { handoffs: [{
      id: handoffId,
      purpose: "verification",
      targetDisplayName: "Admin Example",
      targetEmail: "admin@example.test",
      expiresAt: "2026-10-04T12:30:00.000Z",
    }] };
    return { handoff: { url: secretUrl } };
  };
  await mountSettingsAuthHandoffs(host.target, () => true, host);
  assert.deepEqual(host.renders.at(-1).readState.handoffs.map((row) => row.purpose), ["verification"]);
  assert.equal(host.requests[0].options.headers["x-nova-bootstrap-token"], "private-bootstrap-token");
  const row = host.renders.at(-1).readState.handoffs[0];
  assert.equal(await row.onReveal(), secretUrl);
  assert.equal(host.requests[1].options.headers["x-nova-bootstrap-token"], "private-bootstrap-token");
  assert.doesNotMatch(JSON.stringify(host.renders.at(-1).readState), /private-bootstrap-token|one-time-secret/);
  assert.equal(host.state.bootstrapToken, "");
  assert.equal(host.renders.at(-1).canRead, false);
});

test("an in-flight reveal blocks list refresh and every competing reveal until its result settles", async () => {
  const host = createHost();
  let resolveReveal;
  host.api = async (path, options) => {
    host.requests.push({ path, options });
    if (path === "/api/auth-handoffs") return { handoffs: [{
      id: handoffId,
      purpose: "invitation",
      targetDisplayName: "Taylor Example",
      targetEmail: "taylor@example.test",
      expiresAt: "2026-10-04T12:30:00.000Z",
    }] };
    return new Promise((resolve) => { resolveReveal = resolve; });
  };

  await mountSettingsAuthHandoffs(host.target, () => true, host);
  const row = host.renders.at(-1).readState.handoffs[0];
  const reveal = row.onReveal();
  assert.equal(host.renders.at(-1).revealPending, true);
  await host.renders.at(-1).onRetry();
  await assert.rejects(row.onReveal(), /no longer available/);
  assert.equal(host.requests.filter((request) => request.path === "/api/auth-handoffs").length, 1);
  assert.equal(host.requests.filter((request) => request.path.endsWith("/reveal")).length, 1);

  resolveReveal({ handoff: { url: secretUrl } });
  assert.equal(await reveal, secretUrl);
  assert.equal(host.renders.at(-1).revealPending, false);
});

test("protected list and reveal failures delegate 401/403 recovery to the host", async () => {
  for (const status of [401, 403]) {
    const host = createHost();
    let recoveredStatus = null;
    host.api = async () => { throw Object.assign(new Error("AUTH_FAILURE"), { httpStatus: status }); };
    host.recoverProtectedCommandFailure = (error) => {
      recoveredStatus = error.httpStatus;
      host.target.isConnected = false;
      return true;
    };
    await mountSettingsAuthHandoffs(host.target, () => true, host);
    assert.equal(recoveredStatus, status);
  }

  for (const status of [401, 403]) {
    const host = createHost();
    let recoveredStatus = null;
    host.api = async (path) => {
      if (path === "/api/auth-handoffs") return { handoffs: [{
        id: handoffId,
        purpose: "invitation",
        targetDisplayName: "Taylor Example",
        targetEmail: "taylor@example.test",
        expiresAt: "2026-10-04T12:30:00.000Z",
      }] };
      throw Object.assign(new Error("AUTH_FAILURE"), { httpStatus: status });
    };
    host.recoverProtectedCommandFailure = (error) => {
      recoveredStatus = error.httpStatus;
      host.target.isConnected = false;
      return true;
    };
    await mountSettingsAuthHandoffs(host.target, () => true, host);
    await assert.rejects(host.renders.at(-1).readState.handoffs[0].onReveal());
    assert.equal(recoveredStatus, status);
  }
});

test("a URL response is discarded after the current Settings page is removed", async () => {
  const host = createHost();
  let resolveReveal;
  host.api = async (path, options) => {
    host.requests.push({ path, options });
    if (path === "/api/auth-handoffs") return { handoffs: [{
      id: handoffId,
      purpose: "invitation",
      targetDisplayName: "Taylor Example",
      targetEmail: "taylor@example.test",
      expiresAt: "2026-10-04T12:30:00.000Z",
    }] };
    return new Promise((resolve) => { resolveReveal = resolve; });
  };
  await mountSettingsAuthHandoffs(host.target, () => true, host);
  const action = host.renders.at(-1).readState.handoffs[0].onReveal();
  host.target.isConnected = false;
  resolveReveal({ handoff: { url: secretUrl } });
  await assert.rejects(action, /account changed|link was discarded/i);
  assert.equal(host.renders.some((render) => render.readState?.handoffs?.some((row) => row.url)), false);
});
