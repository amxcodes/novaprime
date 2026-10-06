const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const routeModule = import("./public-password-reset-route.js");

function makeHost(overrides = {}) {
  const events = [];
  const host = {
    async loadFeature() {
      return {
        PasswordReset() {},
        PasswordResetLinkError: class PasswordResetLinkError extends Error {
          constructor() { super("PASSWORD_RESET_LINK_INVALID"); }
        },
      };
    },
    isCurrentPageRequest() { return true; },
    isTargetMounted(target) { return target.isConnected; },
    mountReactIsland(_target, component, props) { events.push({ component, props }); },
    api: async (...args) => { events.push({ api: args }); return {}; },
    requestOptions: (method, body) => ({ method, body }),
    completePasswordReset() { events.push({ completion: "password-reset" }); },
    navigateToPasswordRecovery() { events.push({ navigation: "password-recovery" }); },
    navigateToSignIn() { events.push({ navigation: "sign-in" }); },
    noticeElement(message, kind) { return { message, kind }; },
    ...overrides,
  };
  return { events, host };
}

test("reset uses the existing API path/body while the token stays out of feature props", async () => {
  const { mountPublicPasswordReset } = await routeModule;
  const target = { isConnected: true };
  const token = "secret-reset-token";
  const { events, host } = makeHost();
  await mountPublicPasswordReset(target, "reset-lifetime", token, false, host);
  const props = events.find((event) => event.props)?.props;
  assert.equal(props.linkAvailable, true);
  assert.equal(JSON.stringify(props).includes(token), false);
  await props.onResetPassword("a-long-password");
  assert.deepEqual(events.find((event) => event.api).api, [
    "/api/auth/reset-password",
    { method: "POST", body: { newPassword: "a-long-password", token } },
  ]);
  assert.ok(events.some((event) => event.completion === "password-reset"));
  const source = fs.readFileSync(path.join(__dirname, "../src/features/public/password-reset/PasswordReset.tsx"), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|localStorage|sessionStorage|URLSearchParams|window\.location|console\.(log|info|warn|error)|\binvitationToken\b/);
});

test("missing or rejected links mount without a usable form and cannot call the API", async () => {
  const { mountPublicPasswordReset } = await routeModule;
  for (const [token, rejected] of [[null, false], ["secret-reset-token", true]]) {
    const target = { isConnected: true };
    const { events, host } = makeHost();
    await mountPublicPasswordReset(target, "reset-lifetime", token, rejected, host);
    const props = events.find((event) => event.props)?.props;
    assert.equal(props.linkAvailable, false);
    assert.equal(JSON.stringify(props).includes("secret-reset-token"), false);
    await assert.rejects(props.onResetPassword("a-long-password"), /PASSWORD_RESET_LINK_INVALID/);
    assert.equal(events.some((event) => event.api), false);
    props.onRequestNewLink();
    props.onBackToSignIn();
    assert.deepEqual(events.filter((event) => event.navigation).map((event) => event.navigation), ["password-recovery", "sign-in"]);
  }
});

test("server-expired tokens become a non-retryable link error without exposing provider copy", async () => {
  const { mountPublicPasswordReset } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost({
    api: async () => {
      const error = new Error("raw provider details");
      error.code = "INVALID_TOKEN";
      error.httpStatus = 400;
      throw error;
    },
  });
  await mountPublicPasswordReset(target, "reset-lifetime", "secret-reset-token", false, host);
  const props = events.find((event) => event.props)?.props;
  await assert.rejects(props.onResetPassword("a-long-password"), /PASSWORD_RESET_LINK_INVALID/);
  assert.equal(events.some((event) => event.completion), false);
  assert.equal(events.some((event) => JSON.stringify(event).includes("raw provider details")), false);
});

test("route lifetime guards reject stale commands and ignore stale navigation", async () => {
  const { mountPublicPasswordReset } = await routeModule;
  const target = { isConnected: true };
  let current = true;
  const { events, host } = makeHost({ isCurrentPageRequest: () => current });
  await mountPublicPasswordReset(target, "reset-lifetime", "secret-reset-token", false, host);
  const props = events.find((event) => event.props)?.props;
  current = false;
  props.onRequestNewLink();
  props.onBackToSignIn();
  await assert.rejects(props.onResetPassword("a-long-password"), /PASSWORD_RESET_CONTEXT_EXPIRED/);
  assert.equal(events.some((event) => event.navigation), false);
  assert.equal(events.some((event) => event.api), false);
});

test("load failures are route guarded and the heading receives programmatic focus", async () => {
  const { mountPublicPasswordReset } = await routeModule;
  const target = {
    isConnected: true,
    replaceChildren(...children) { this.children = children; },
  };
  const { host } = makeHost({ loadFeature: async () => { throw new Error("load failed"); } });
  await mountPublicPasswordReset(target, "reset-lifetime", "secret-reset-token", false, host);
  assert.deepEqual(target.children, [{ message: "Password reset could not load. Reload this page to try again.", kind: "error" }]);

  let focused = false;
  const heading = { focus() { focused = true; } };
  const focusTarget = { isConnected: true, querySelector(selector) { return selector === "h1" ? heading : null; } };
  await mountPublicPasswordReset(focusTarget, "reset-lifetime", "secret-reset-token", false, makeHost().host);
  assert.equal(heading.tabIndex, -1);
  assert.equal(focused, true);
});

test("an API result after route navigation does not complete password reset", async () => {
  const { mountPublicPasswordReset } = await routeModule;
  let current = true;
  let resolveRequest;
  const { events, host } = makeHost({
    isCurrentPageRequest: () => current,
    api: () => new Promise((resolve) => { resolveRequest = resolve; }),
  });
  await mountPublicPasswordReset({ isConnected: true }, "reset-lifetime", "secret-reset-token", false, host);
  const props = events.find((event) => event.props)?.props;
  const request = props.onResetPassword("a-long-password");
  current = false;
  resolveRequest({});
  await assert.rejects(request, /PASSWORD_RESET_CONTEXT_EXPIRED/);
  assert.equal(events.some((event) => event.completion), false);
});
