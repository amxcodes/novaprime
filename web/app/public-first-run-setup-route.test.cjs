const assert = require("node:assert/strict");
const { test } = require("node:test");

const routeModule = import("./public-first-run-setup-route.js");

function makeFeature() {
  class FirstRunSetupActionError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.title = options.title;
      this.kind = options.kind || "error";
    }
  }
  return { FirstRunSetup() {}, FirstRunSetupActionError };
}

function values(overrides = {}) {
  return {
    name: "Avery Example",
    organisationName: "Example Studio",
    email: "avery@example.test",
    password: "private-password",
    publicOrigin: "https://work.example.test",
    attendanceMode: "hour_based",
    requiredAttendanceMinutes: 480,
    bootstrapToken: "private-bootstrap-token",
    ...overrides,
  };
}

function makeHost(overrides = {}) {
  const events = [];
  const host = {
    async loadFeature() { return makeFeature(); },
    isCurrentPageRequest() { return true; },
    isTargetMounted(target) { return target.isConnected; },
    mountReactIsland(_target, component, props) { events.push({ component, props }); },
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "PATCH") {
        return { configuredOrigin: "https://work.example.test", effectiveOrigin: "https://work.example.test" };
      }
      return {};
    },
    requestOptions: (method, body, headers) => ({ method, body, headers }),
    publicOrigin: () => "https://work.example.test",
    hasBootstrapCredentials: () => true,
    resumeFounder: () => null,
    isResumableFounder: () => false,
    currentSessionEmail: () => "",
    readCurrentSessionEmail: async () => null,
    retainBootstrapCredentials: (token, email) => events.push({ retained: { token, email } }),
    recordPublicOrigin: (result) => events.push({ origin: result }),
    publicOriginSaveFailed: (error) => events.push({ originFailure: error }),
    completeSetup: async (result) => events.push({ completion: result }),
    navigateBack() { events.push({ navigation: "back" }); },
    noticeElement(message, kind) { return { message, kind }; },
    ...overrides,
  };
  return { events, host };
}

async function mount(route, host) {
  const target = { isConnected: true };
  await route(target, "setup-lifetime", host);
  return { target, props: host.mountReactIsland && host.mountReactIsland.mockProps };
}

test("setup preserves the existing three request contracts and delegates completion to the app host", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const { events, host } = makeHost();
  const target = { isConnected: true };
  await route(target, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  assert.equal(props.initialPublicOrigin, "https://work.example.test");
  await props.onSubmit(values());

  assert.deepEqual(events.filter((event) => event.api).map((event) => event.api), [
    ["/api/setup/register", { method: "POST", body: {
      email: "avery@example.test", name: "Avery Example", password: "private-password",
    }, headers: { "x-nova-bootstrap-token": "private-bootstrap-token" } }],
    ["/api/organisation/bootstrap", { method: "POST", body: {
      organisationName: "Example Studio", attendanceMode: "hour_based", requiredAttendanceMinutes: 480,
    }, headers: { "x-nova-bootstrap-token": "private-bootstrap-token" } }],
    ["/api/organisation/public-origin", { method: "PATCH", body: {
      origin: "https://work.example.test",
    }, headers: { "x-nova-bootstrap-token": "private-bootstrap-token" } }],
  ]);
  assert.ok(events.some((event) => event.retained?.email === "avery@example.test"));
  assert.deepEqual(events.find((event) => event.completion)?.completion, { originSaved: true, originSaveError: null });
  assert.equal(JSON.stringify(props).includes("private-bootstrap-token"), false);
});

test("a failed organisation bootstrap retry resumes after the confirmed founder registration", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  let failBootstrap = true;
  const { events, host } = makeHost({
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/organisation/bootstrap" && failBootstrap) {
        failBootstrap = false;
        const error = new Error("INTERNAL_ERROR");
        error.code = "INTERNAL_ERROR";
        throw error;
      }
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "PATCH") {
        return { configuredOrigin: "https://work.example.test" };
      }
      return {};
    },
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await assert.rejects(props.onSubmit(values()), /founder account was created/i);
  await props.onSubmit(values());

  assert.equal(events.filter((event) => event.api?.[0] === "/api/setup/register").length, 1);
  assert.equal(events.filter((event) => event.api?.[0] === "/api/organisation/bootstrap").length, 2);
  assert.equal(events.filter((event) => event.api?.[0] === "/api/organisation/public-origin" && event.api[1]?.method === "PATCH").length, 1);
  assert.equal(events.filter((event) => event.completion).length, 1);
});

test("an already-completed bootstrap is accepted only after the founder can read public-origin settings", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const { events, host } = makeHost({
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/organisation/bootstrap") {
        const error = new Error("ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED");
        error.code = "ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED";
        throw error;
      }
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "PATCH") {
        return { configuredOrigin: "https://work.example.test" };
      }
      return {};
    },
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await props.onSubmit(values());
  assert.equal(events.filter((event) => event.api?.[0] === "/api/organisation/public-origin" && event.api[1]?.method === "GET").length, 1);
  assert.equal(events.filter((event) => event.completion).length, 1);
});

test("an origin-save failure remains non-fatal after workspace creation", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const failure = new Error("PUBLIC_ORIGIN_NOT_ALLOWED");
  const { events, host } = makeHost({
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "PATCH") throw failure;
      return {};
    },
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await props.onSubmit(values());
  assert.equal(events.some((event) => event.originFailure === failure), true);
  assert.deepEqual(events.find((event) => event.completion)?.completion, { originSaved: false, originSaveError: failure });
});

test("an origin timeout is read back before the UI reports that the URL was not saved", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const failure = new Error("connection lost");
  const { events, host } = makeHost({
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "PATCH") throw failure;
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "GET") {
        return { configuredOrigin: "https://work.example.test" };
      }
      return {};
    },
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await props.onSubmit(values());
  assert.equal(events.some((event) => event.api?.[0] === "/api/organisation/public-origin" && event.api[1]?.method === "GET"), true);
  assert.equal(events.some((event) => event.originFailure), false);
  assert.deepEqual(events.find((event) => event.completion)?.completion, { originSaved: true, originSaveError: failure });
});

test("a host-confirmed founder resumes setup without sending registration or password fields", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const { events, host } = makeHost({
    resumeFounder: () => ({ email: "avery@example.test", displayName: "Avery Example" }),
    isResumableFounder: (email) => email === "avery@example.test",
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  assert.deepEqual(props.resumeFounder, { email: "avery@example.test", displayName: "Avery Example" });
  await props.onSubmit({
    founderMode: "resume",
    email: "avery@example.test",
    displayName: "Avery Example",
    organisationName: "Example Studio",
    publicOrigin: "https://work.example.test",
    attendanceMode: "scheduled",
    requiredAttendanceMinutes: 480,
    bootstrapToken: "private-bootstrap-token",
  });
  assert.equal(events.some((event) => event.api?.[0] === "/api/setup/register"), false);
  const bootstrap = events.find((event) => event.api?.[0] === "/api/organisation/bootstrap");
  assert.deepEqual(bootstrap.api[1].body, {
    organisationName: "Example Studio", attendanceMode: "scheduled", requiredAttendanceMinutes: 480,
  });
  assert.equal(events.some((event) => event.completion), true);
});

test("a lost registration response is reconciled through the existing session read and is never blindly replayed", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const { events, host } = makeHost({
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/setup/register") throw new TypeError("network response lost");
      if (args[0] === "/api/organisation/public-origin" && args[1]?.method === "PATCH") return { configuredOrigin: "https://work.example.test" };
      return {};
    },
    readCurrentSessionEmail: async () => "avery@example.test",
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await props.onSubmit(values());
  assert.equal(events.filter((event) => event.api?.[0] === "/api/setup/register").length, 1);
  assert.equal(events.filter((event) => event.api?.[0] === "/api/organisation/bootstrap").length, 1);
  assert.equal(events.filter((event) => event.api?.[0] === "/api/auth/get-session").length, 0);
});

test("an unconfirmed lost registration response blocks repeat registration on the same route", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const { events, host } = makeHost({
    api: async (...args) => {
      events.push({ api: args });
      if (args[0] === "/api/setup/register") throw new TypeError("network response lost");
      return {};
    },
    readCurrentSessionEmail: async () => null,
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await assert.rejects(props.onSubmit(values()), /cannot confirm whether the account exists/i);
  await assert.rejects(props.onSubmit(values()), /do not submit founder registration again/i);
  assert.equal(events.filter((event) => event.api?.[0] === "/api/setup/register").length, 1);
});

test("server errors are reduced to safe setup copy and load failures stay route guarded", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  const invalidToken = new Error("ORGANISATION_BOOTSTRAP_TOKEN_INVALID");
  invalidToken.code = "ORGANISATION_BOOTSTRAP_TOKEN_INVALID";
  invalidToken.httpStatus = 403;
  const { events, host } = makeHost({ api: async (...args) => { events.push({ api: args }); throw invalidToken; } });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await assert.rejects(props.onSubmit(values()), (error) => {
    assert.match(error.message, /deployment setup token was not accepted/i);
    assert.doesNotMatch(error.message, /ORGANISATION_BOOTSTRAP_TOKEN_INVALID/);
    return true;
  });

  const target = { isConnected: true, replaceChildren(...children) { this.children = children; } };
  const failedHost = makeHost({ loadFeature: async () => { throw new Error("untrusted module detail"); } }).host;
  await route(target, "setup-lifetime", failedHost);
  assert.deepEqual(target.children, [{ message: "NOVA setup could not load. Reload this page to try again.", kind: "error" }]);
});

test("stale routes do not continue from registration into organisation bootstrap", async () => {
  const { createPublicFirstRunSetupRoute } = await routeModule;
  const route = createPublicFirstRunSetupRoute();
  let current = true;
  const { events, host } = makeHost({
    isCurrentPageRequest: () => current,
    api: async (...args) => {
      events.push({ api: args });
      current = false;
      return {};
    },
  });
  await route({ isConnected: true }, "setup-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await assert.rejects(props.onSubmit(values()), /setup page is no longer active/i);
  assert.equal(events.filter((event) => event.api).length, 1);
});
