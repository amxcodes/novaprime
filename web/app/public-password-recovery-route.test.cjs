const assert = require("node:assert/strict");
const { test } = require("node:test");

const routeModule = import("./public-password-recovery-route.js");

function makeHost(overrides = {}) {
  const events = [];
  const host = {
    notice: null,
    async loadFeature() { return { PasswordRecovery() {} }; },
    isCurrentPageRequest() { return true; },
    isTargetMounted(target) { return target.isConnected; },
    mountReactIsland(_target, component, props) { events.push({ component, props }); },
    api: async (...args) => { events.push({ api: args }); return {}; },
    requestOptions: (method, body) => ({ method, body }),
    publicOrigin: () => "https://nova.example.test",
    navigateToSignIn() { events.push({ navigation: "sign-in" }); },
    noticeElement(message, kind) { return { message, kind }; },
    ...overrides,
  };
  return { events, host };
}

test("password recovery uses the existing endpoint and exact redirect payload", async () => {
  const { mountPublicPasswordRecovery } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicPasswordRecovery(target, "forgot-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  await props.onRequestReset("person@example.test");
  assert.deepEqual(events.find((event) => event.api).api, [
    "/api/auth/request-password-reset",
    { method: "POST", body: { email: "person@example.test", redirectTo: "https://nova.example.test/reset-password" } },
  ]);
  assert.equal(events.some((event) => event.navigation), false);
});

test("back navigation is host-owned and stale callbacks are ignored", async () => {
  const { mountPublicPasswordRecovery } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicPasswordRecovery(target, "forgot-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  props.onBackToSignIn();
  assert.equal(events.filter((event) => event.navigation === "sign-in").length, 1);
  host.isCurrentPageRequest = () => false;
  props.onBackToSignIn();
  await assert.rejects(props.onRequestReset("person@example.test"), /CONTEXT_EXPIRED/);
  assert.equal(events.filter((event) => event.api).length, 0);
  assert.equal(events.filter((event) => event.navigation === "sign-in").length, 1);
});

test("load failure is presented only while the route remains current", async () => {
  const { mountPublicPasswordRecovery } = await routeModule;
  const target = { isConnected: true, replaceChildren(...children) { this.children = children; } };
  const { events, host } = makeHost({ loadFeature: async () => { throw new Error("load failed"); } });
  await mountPublicPasswordRecovery(target, "forgot-lifetime", host);
  assert.deepEqual(target.children, [{ message: "Password recovery could not load. Reload this page to try again.", kind: "error" }]);
  assert.equal(events.some((event) => event.props), false);
});

test("focuses the mounted feature heading", async () => {
  const { mountPublicPasswordRecovery } = await routeModule;
  let focused = false;
  const heading = { focus() { focused = true; } };
  const target = { isConnected: true, querySelector(selector) { return selector === "h1" ? heading : null; } };
  const { host } = makeHost();
  await mountPublicPasswordRecovery(target, "forgot-lifetime", host);
  assert.equal(heading.tabIndex, -1);
  assert.equal(focused, true);
});

test("a recovery result that arrives after route navigation is discarded", async () => {
  const { mountPublicPasswordRecovery } = await routeModule;
  const target = { isConnected: true };
  let resolveRequest;
  let current = true;
  const { events, host } = makeHost({
    isCurrentPageRequest: () => current,
    api: async (...args) => {
      events.push({ api: args });
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  await mountPublicPasswordRecovery(target, "forgot-lifetime", host);
  const props = events.find((event) => event.props)?.props;
  const request = props.onRequestReset("person@example.test");
  current = false;
  resolveRequest({});
  await assert.rejects(request, /CONTEXT_EXPIRED/);
});
