const assert = require("node:assert/strict");
const { test } = require("node:test");

const routeModule = import("./public-sign-in-route.js");

function makeHost(overrides = {}) {
  const events = [];
  const state = { session: null, view: "login" };
  const host = {
    state,
    notice: { kind: "success", message: "Your password was reset." },
    async loadFeature() { return { SignIn: function SignIn() {} }; },
    isCurrentPageRequest() { return true; },
    isTargetMounted(target) { return target.isConnected; },
    mountReactIsland(_target, component, props) { events.push({ component, props }); },
    api: async (...args) => { events.push({ api: args }); return {}; },
    requestOptions: (method, body) => ({ method, body }),
    async refreshSession() { state.session = { id: "person-1" }; events.push({ refreshed: true }); },
    isLoginRoute() { return true; },
    captureCommandContext(target) { return { target }; },
    isCurrentCommandIdentity() { return false; },
    recoverProtectedCommandFailure(error) { events.push({ recovered: error }); return true; },
    completeSignIn() { events.push({ completed: true }); },
    renderCurrentRoute() { events.push({ rendered: true }); },
    navigateToForgotPassword() { events.push({ navigation: "forgot" }); },
    navigateBack() { events.push({ navigation: "back" }); },
    noticeElement(message) { return { message }; },
    consumeNotice(notice) { events.push({ consumedNotice: notice }); },
    ...overrides,
  };
  return { events, host, state };
}

test("public sign-in delegates the existing credential request and session refresh to the host", async () => {
  const { mountPublicSignIn } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicSignIn(target, {}, host);
  const props = events.find((event) => event.props)?.props;

  assert.equal(props.notice, host.notice);
  assert.ok(events.some((event) => event.consumedNotice === host.notice));
  await props.onSignIn({ email: "user@example.com", password: "transient password" });
  const request = events.find((event) => event.api)?.api;
  assert.equal(request[0], "/api/auth/sign-in/email");
  assert.deepEqual(request[1], {
    method: "POST",
    body: { email: "user@example.com", password: "transient password" },
  });
  assert.ok(events.some((event) => event.refreshed));
  assert.ok(events.some((event) => event.completed));
});

test("navigation callbacks preserve the host routes and are ignored after the page becomes stale", async () => {
  const { mountPublicSignIn } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicSignIn(target, {}, host);
  const props = events.find((event) => event.props)?.props;
  props.onForgotPassword();
  props.onBack();
  assert.deepEqual(events.filter((event) => event.navigation).map((event) => event.navigation), ["forgot", "back"]);

  host.isCurrentPageRequest = () => false;
  props.onForgotPassword();
  assert.equal(events.filter((event) => event.navigation === "forgot").length, 1);
});

test("stale route completion refreshes the current route without hijacking browser navigation", async () => {
  const { mountPublicSignIn } = await routeModule;
  const target = { isConnected: true };
  let current = true;
  const { events, host } = makeHost({
    state: { session: null, view: "forgot" },
    async refreshSession() {
      host.state.session = { id: "person-1" };
      current = false;
    },
    isCurrentPageRequest: () => current,
    isLoginRoute: () => false,
  });
  await mountPublicSignIn(target, {}, host);
  const props = events.find((event) => event.props)?.props;
  await props.onSignIn({ email: "user@example.com", password: "transient password" });
  assert.ok(events.some((event) => event.rendered));
  assert.equal(events.some((event) => event.completed), false);
  assert.equal(host.state.view, "forgot");
});

test("an old request cannot redirect a new sign-in mount after leaving and re-entering login", async () => {
  const { mountPublicSignIn } = await routeModule;
  const target = { isConnected: true };
  let current = true;
  const { events, host } = makeHost({
    async refreshSession() {
      host.state.session = { id: "person-1" };
      target.isConnected = false;
      current = false;
    },
    isCurrentPageRequest: () => current,
    isLoginRoute: () => true,
  });
  await mountPublicSignIn(target, {}, host);
  const props = events.find((event) => event.props)?.props;
  await props.onSignIn({ email: "user@example.com", password: "transient password" });
  assert.equal(events.some((event) => event.completed), false);
  assert.ok(events.some((event) => event.rendered));
  assert.equal(host.state.view, "login");
});

test("authenticated 401 responses still pass through the existing protected-command recovery", async () => {
  const { mountPublicSignIn } = await routeModule;
  const target = { isConnected: true };
  const rejected = Object.assign(new Error("UNAUTHORIZED"), { httpStatus: 401 });
  const { events, host, state } = makeHost({ api: async () => { throw rejected; } });
  state.session = { id: "existing-person" };
  host.isCurrentCommandIdentity = () => true;
  await mountPublicSignIn(target, {}, host);
  const props = events.find((event) => event.props)?.props;
  await assert.rejects(props.onSignIn({ email: "user@example.com", password: "bad password" }), rejected);
  assert.ok(events.some((event) => event.recovered === rejected));
  assert.equal(events.some((event) => event.refreshed), false);
});

test("the page heading receives focus after the lazy feature is mounted", async () => {
  const { mountPublicSignIn } = await routeModule;
  let focused = false;
  const heading = { focus() { focused = true; } };
  const target = { isConnected: true, querySelector(selector) { return selector === "h1" ? heading : null; } };
  const { host } = makeHost();
  await mountPublicSignIn(target, {}, host);
  assert.equal(heading.tabIndex, -1);
  assert.equal(focused, true);
});

test("does not mount a feature after its route has already been left", async () => {
  const { mountPublicSignIn } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost({ isCurrentPageRequest: () => false });
  await mountPublicSignIn(target, {}, host);
  assert.equal(events.some((event) => event.props), false);
});
