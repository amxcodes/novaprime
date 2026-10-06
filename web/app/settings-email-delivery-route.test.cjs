const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

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

const routeModule = import("./settings-email-delivery-route.js");
const featureContracts = require("../src/features/settings/email-delivery/contracts.ts");
const featureProjection = require("../src/features/settings/email-delivery/projection.ts");

const connectionId = "40000000-0000-4000-8000-000000000001";
const gmailConnectionId = "40000000-0000-4000-8000-000000000002";
const smtpConnection = {
  id: connectionId,
  name: "Primary SMTP",
  provider: "smtp",
  senderEmail: "people@example.test",
  replyToEmail: null,
  isActive: false,
  lastTestedAt: null,
  lastTestErrorCode: null,
  credentials: { password: "must not reach the view" },
};

function makeHarness(overrides = {}) {
  const events = [];
  const target = {
    isConnected: true,
    replaceChildren(...children) { events.push({ replaced: children }); },
  };
  const state = { identityEpoch: 4, emailOAuthResult: null };
  let currentPage = true;
  let currentIdentity = true;
  let currentCommand = true;
  let api = async (url, options) => {
    events.push({ request: [url, options] });
    if (!options) return { supportedProviders: ["smtp", "gmail_oauth2"], connections: [smtpConnection] };
    return {};
  };
  let featureLoad = async () => ({
    EmailDelivery() {},
    ...featureProjection,
    ...featureContracts,
  });
  const originListeners = [];
  const originBridge = {
    current: { status: "ready", configuredOrigin: "https://nova.example.test", effectiveOrigin: "https://fallback.example.test" },
    subscribe(listener) { originListeners.push(listener); listener(this.current); },
    retry() { events.push({ originRetry: true }); },
  };
  const host = {
    state,
    api: (...args) => api(...args),
    requestOptions(method, body) { return { method, body }; },
    captureCommandContext(source) { return { source, identityEpoch: state.identityEpoch }; },
    isCurrentCommand() { return currentCommand; },
    isCurrentCommandIdentity() { return currentIdentity; },
    recoverProtectedCommandFailure(error, context, message) {
      events.push({ recovered: { error, context, message } });
      return overrides.recoverResult || false;
    },
    mountReactIsland(_target, component, props) { events.push({ render: { component, props } }); },
    noticeElement(message, kind) { return { message, kind }; },
    errorText(error) { return `safe:${error?.code || "unknown"}`; },
    setMessage(message, kind) { events.push({ feedback: { message, kind } }); },
    showFeedback() { events.push({ showFeedback: true }); },
    navigateToGoogleAuthorization(url) { events.push({ navigate: url }); },
    loadFeature: () => featureLoad(),
  };
  const options = {
    target,
    isCurrentSettings: () => currentPage,
    canReadOrigin: true,
    canActWithUnknownPublicOrigin: false,
    originBridge,
    host,
    ...overrides.options,
  };

  return {
    events,
    target,
    state,
    originBridge,
    originListeners,
    host,
    options,
    setApi(value) { api = value; },
    setFeatureLoad(value) { featureLoad = value; },
    setPageCurrent(value) { currentPage = value; },
    setIdentityCurrent(value) { currentIdentity = value; },
    setCommandCurrent(value) { currentCommand = value; },
    get props() { return events.filter((event) => event.render).at(-1)?.render.props; },
  };
}

async function flushReads() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("loads the connection read only for the live Settings mount and keeps origin visibility separate", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness({ options: { canReadOrigin: false, canActWithUnknownPublicOrigin: true } });
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();

  assert.equal(harness.events.find((event) => event.request)?.request[0], "/api/email-connections");
  assert.equal(harness.props.readState.status, "ready");
  assert.equal(harness.props.publicOriginConfigured, null);
  assert.equal(harness.props.canActWithUnknownPublicOrigin, true);
  assert.equal(harness.props.publicOrigin, undefined);
  assert.equal(Object.hasOwn(harness.props, "onRetryOrigin"), false);
  assert.equal(harness.props.connections.length, 1);
  assert.equal(Object.hasOwn(harness.props.connections[0], "id"), false);
  assert.equal(Object.hasOwn(harness.props.connections[0], "credentials"), false);
});

test("publishes only the readable public origin and retries the separate origin read through its bridge", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness();
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();

  assert.equal(harness.props.publicOriginConfigured, true);
  assert.equal(harness.props.publicOrigin, "https://nova.example.test");
  assert.equal(typeof harness.props.onRetryOrigin, "function");
  harness.props.onRetryOrigin();
  assert.ok(harness.events.some((event) => event.originRetry));

  harness.originListeners[0]({ status: "error", message: "Origin read failed." });
  assert.equal(harness.props.publicOriginConfigured, null);
  assert.equal(harness.props.publicOriginError, "Origin read failed.");
});

test("preserves the create payload, uses the existing connection endpoints, and refreshes after a confirmed action", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness();
  const requests = [];
  harness.setApi(async (url, options) => {
    requests.push([url, options]);
    if (!options) return { supportedProviders: ["smtp"], connections: [smtpConnection] };
    return { accepted: true };
  });
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();

  const input = {
    name: "Primary SMTP",
    senderEmail: "people@example.test",
    provider: "smtp",
    credentials: { host: "smtp.example.test", port: 587, username: "mailer", password: "transient" , secure: true },
  };
  await harness.props.onCreate(input);
  await harness.props.connections[0].onTest("check@example.test");

  assert.deepEqual(requests[0], ["/api/email-connections", undefined]);
  assert.deepEqual(requests[1], ["/api/email-connections", { method: "POST", body: input }]);
  assert.deepEqual(requests[3], [`/api/email-connections/${connectionId}/test`, { method: "POST", body: { recipientEmail: "check@example.test" } }]);
  assert.equal(requests.filter(([url, options]) => url === "/api/email-connections" && !options).length, 3);
  assert.ok(requests[1][1].body.credentials.password === "transient");
});

test("uses the existing activate, deactivate, and Google authorization endpoints and validates the redirect origin", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness();
  const requests = [];
  const gmailConnection = {
    ...smtpConnection,
    id: gmailConnectionId,
    name: "Google Workspace",
    provider: "gmail_oauth2",
  };
  harness.setApi(async (url, options) => {
    requests.push([url, options]);
    if (!options) return { supportedProviders: ["smtp", "gmail_oauth2"], connections: [smtpConnection, gmailConnection] };
    if (url.endsWith("/gmail/connect")) return { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=nova" };
    return {};
  });
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();

  await harness.props.connections[0].onActivate();
  await harness.props.connections[0].onDeactivate();
  await harness.props.connections[1].onConnectGoogle();

  assert.ok(requests.some(([url, options]) => url === `/api/email-connections/${connectionId}/activate` && options?.method === "POST"));
  assert.ok(requests.some(([url, options]) => url === `/api/email-connections/${connectionId}/deactivate` && options?.method === "POST"));
  assert.ok(requests.some(([url, options]) => url === `/api/email-connections/${gmailConnectionId}/gmail/connect` && options?.method === "POST"));
  assert.deepEqual(harness.events.find((event) => event.navigate)?.navigate,
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=nova");

  const unsafe = makeHarness();
  unsafe.setApi(async (_url, options) => options
    ? { authorizationUrl: "https://accounts.google.evil.test/steal" }
    : { supportedProviders: ["gmail_oauth2"], connections: [gmailConnection] });
  await mountSettingsEmailDeliveryRoute(unsafe.options);
  await flushReads();
  await assert.rejects(unsafe.props.connections[0].onConnectGoogle(), (error) => {
    assert.equal(error.kind, "unconfirmed");
    return true;
  });
  assert.equal(unsafe.events.some((event) => event.navigate), false);
});

test("maps known 409 domain conflicts and definitive 4xx rejections without changing safe messages", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness();
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();
  harness.setApi(async (_url, options) => {
    if (!options) return { supportedProviders: ["smtp"], connections: [] };
    throw Object.assign(new Error("EMAIL_CONNECTION_ALREADY_EXISTS"), {
      code: "EMAIL_CONNECTION_ALREADY_EXISTS",
      httpStatus: 409,
    });
  });
  const input = { name: "Existing", senderEmail: "people@example.test", provider: "console" };
  await assert.rejects(harness.props.onCreate(input), (error) => {
    assert.ok(error instanceof featureContracts.EmailDeliveryActionError);
    assert.equal(error.kind, "conflict");
    assert.equal(error.message, "safe:EMAIL_CONNECTION_ALREADY_EXISTS");
    return true;
  });

  harness.setApi(async () => {
    throw Object.assign(new Error("EMAIL_CONNECTION_INPUT_INVALID"), {
      code: "EMAIL_CONNECTION_INPUT_INVALID",
      httpStatus: 422,
    });
  });
  await assert.rejects(harness.props.onCreate(input), (error) => {
    assert.ok(error instanceof featureContracts.EmailDeliveryActionError);
    assert.equal(error.kind, "error");
    assert.equal(error.message, "safe:EMAIL_CONNECTION_INPUT_INVALID");
    return true;
  });
});

test("classifies 5xx and transport failures as unconfirmed so callers must reconcile before retry", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness();
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();
  const input = { name: "Primary", senderEmail: "people@example.test", provider: "console" };

  for (const failure of [
    Object.assign(new Error("REQUEST_FAILED"), { code: "REQUEST_FAILED", httpStatus: 503 }),
    Object.assign(new Error("network interrupted"), { code: "NETWORK_ERROR" }),
  ]) {
    harness.setApi(async (_url, options) => {
      if (!options) return { supportedProviders: ["console"], connections: [] };
      throw failure;
    });
    await assert.rejects(harness.props.onCreate(input), (error) => {
      assert.ok(error instanceof featureContracts.EmailDeliveryActionError);
      assert.equal(error.kind, "unconfirmed");
      return true;
    });
  }
});

test("a protected 403 still enters permission recovery and does not publish a false mutation result", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness({ recoverResult: true });
  await mountSettingsEmailDeliveryRoute(harness.options);
  await flushReads();
  harness.setApi(async (_url, options) => {
    if (!options) return { supportedProviders: ["console"], connections: [] };
    throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN", httpStatus: 403 });
  });

  await assert.rejects(harness.props.onCreate({
    name: "Primary",
    senderEmail: "people@example.test",
    provider: "console",
  }), (error) => {
    assert.equal(error.kind, "error");
    assert.match(error.message, /access changed while saving/);
    return true;
  });
  assert.match(harness.events.find((event) => event.recovered)?.recovered.message, /access changed while saving/);
});

test("stale identity or page lifetime blocks late feature loading and reads", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const stalePage = makeHarness();
  stalePage.setPageCurrent(false);
  await mountSettingsEmailDeliveryRoute(stalePage.options);
  assert.equal(stalePage.events.some((event) => event.render || event.request), false);

  const staleIdentity = makeHarness();
  staleIdentity.setFeatureLoad(async () => {
    staleIdentity.state.identityEpoch += 1;
    return { EmailDelivery() {}, ...featureProjection, ...featureContracts };
  });
  await mountSettingsEmailDeliveryRoute(staleIdentity.options);
  assert.equal(staleIdentity.events.some((event) => event.render || event.request), false);
});

test("failed lazy loading retains the host feedback and consumes the one-time OAuth result once", async () => {
  const { mountSettingsEmailDeliveryRoute } = await routeModule;
  const harness = makeHarness();
  harness.state.emailOAuthResult = { status: "error", message: "Google authorization was cancelled." };
  harness.setFeatureLoad(async () => { throw new Error("chunk unavailable"); });
  await mountSettingsEmailDeliveryRoute(harness.options);

  assert.equal(harness.state.emailOAuthResult, null);
  assert.deepEqual(harness.events.find((event) => event.feedback).feedback, {
    message: "Google authorization was cancelled.",
    kind: "error",
  });
  assert.ok(harness.events.some((event) => event.showFeedback));
  assert.match(harness.events.find((event) => event.replaced)?.replaced[0].message, /could not load/);
});
