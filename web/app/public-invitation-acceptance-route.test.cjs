const assert = require("node:assert/strict");
const { test } = require("node:test");

const routeModule = import("./public-invitation-acceptance-route.js");
const invitationToken = "opaque-one-time-invitation-token";

function makeFeature() {
  class InvitationAcceptanceError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }
  return { InvitationAcceptance() {}, InvitationAcceptanceError };
}

function makeHost(overrides = {}) {
  const events = [];
  const host = {
    notice: null,
    async loadFeature() { return makeFeature(); },
    isCurrentPageRequest() { return true; },
    isTargetMounted(target) { return target.isConnected; },
    mountReactIsland(_target, component, props) { events.push({ component, props }); },
    api: async (...args) => { events.push({ api: args }); return { verificationSent: true }; },
    requestOptions: (method, body) => ({ method, body }),
    navigateToSignIn() { events.push({ navigation: "sign-in" }); },
    navigateToNOVA() { events.push({ navigation: "nova" }); },
    noticeElement(message, kind) { return { message, kind }; },
    consumeNotice(notice) { events.push({ consumedNotice: notice }); },
    ...overrides,
  };
  return { events, host };
}

test("acceptance sends the exact existing payload and keeps token out of component props", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  const props = events.find((event) => event.props)?.props;
  assert.equal(props.invitationAvailable, true);
  assert.equal(JSON.stringify(props).includes(invitationToken), false);
  assert.deepEqual(await props.onAccept({
    email: "person@example.test",
    name: "Taylor Example",
    password: "private password",
  }), { verificationSent: true });
  assert.deepEqual(events.find((event) => event.api).api, [
    "/api/invitations/accept",
    { method: "POST", body: {
      email: "person@example.test",
      invitationToken,
      name: "Taylor Example",
      password: "private password",
    } },
  ]);
  assert.equal(events.some((event) => event.navigation), false);
});

test("missing token still mounts with invitationAvailable false and cannot call the API", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicInvitationAcceptance(target, "invite-lifetime", "", host);
  const props = events.find((event) => event.props)?.props;
  assert.equal(props.invitationAvailable, false);
  assert.equal(props.notice, null);
  await assert.rejects(props.onAccept({ email: "person@example.test", name: "Taylor", password: "secret" }), (error) => {
    assert.equal(error.kind, "warning");
    assert.match(error.message, /invitation link is incomplete/i);
    return true;
  });
  assert.equal(events.some((event) => event.api), false);
  assert.equal(JSON.stringify(props).includes(invitationToken), false);
});

test("the sign-in action delegates to the host and is ignored after navigation", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  const props = events.find((event) => event.props)?.props;
  props.onBackToSignIn();
  assert.equal(events.filter((event) => event.navigation === "sign-in").length, 1);
  host.isCurrentPageRequest = () => false;
  props.onBackToSignIn();
  assert.equal(events.filter((event) => event.navigation === "sign-in").length, 1);
});

test("the missing-invitation return action delegates to the landing route", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost();
  await mountPublicInvitationAcceptance(target, "invite-lifetime", "", host);
  const props = events.find((event) => event.props)?.props;
  props.onReturnToNOVA();
  assert.equal(events.filter((event) => event.navigation === "nova").length, 1);
  host.isCurrentPageRequest = () => false;
  props.onReturnToNOVA();
  assert.equal(events.filter((event) => event.navigation === "nova").length, 1);
});

test("server verificationSent false is returned as a boolean and host owns no post-submit navigation", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost({ api: async (...args) => { events.push({ api: args }); return { verificationSent: false }; } });
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  const props = events.find((event) => event.props)?.props;
  const result = await props.onAccept({ email: "person@example.test", name: "Taylor", password: "secret" });
  assert.deepEqual(result, { verificationSent: false });
  assert.equal(typeof result.verificationSent, "boolean");
  assert.equal(events.some((event) => event.navigation), false);
});

test("an absent verification result is not converted into a false delivery claim", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost({ api: async (...args) => { events.push({ api: args }); return {}; } });
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  const props = events.find((event) => event.props)?.props;
  assert.equal(await props.onAccept({ email: "person@example.test", name: "Taylor", password: "secret" }), undefined);
});

test("stale callbacks do not send an invitation or consume notices", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  const { events, host } = makeHost({ isCurrentPageRequest: () => false });
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  assert.equal(events.some((event) => event.props), false);
  assert.equal(events.some((event) => event.consumedNotice), false);
});

test("load failure does not show an error on an expired route", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true, replaceChildren(...children) { this.children = children; } };
  const { events, host } = makeHost({
    loadFeature: async () => { throw new Error("load failed"); },
    isCurrentPageRequest: () => false,
  });
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  assert.equal(target.children, undefined);
  assert.equal(events.some((event) => event.props), false);
});

test("focuses heading after mounting and consumes the host notice", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  let focused = false;
  const heading = { focus() { focused = true; } };
  const target = { isConnected: true, querySelector(selector) { return selector === "h1" ? heading : null; } };
  const notice = { kind: "success", message: "Invitation is ready." };
  const { events, host } = makeHost({ notice });
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  assert.equal(heading.tabIndex, -1);
  assert.equal(focused, true);
  assert.ok(events.some((event) => event.consumedNotice === notice));
});

test("an acceptance result that arrives after route navigation is discarded", async () => {
  const { mountPublicInvitationAcceptance } = await routeModule;
  const target = { isConnected: true };
  let current = true;
  let resolveRequest;
  const { events, host } = makeHost({
    isCurrentPageRequest: () => current,
    api: async (...args) => {
      events.push({ api: args });
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  await mountPublicInvitationAcceptance(target, "invite-lifetime", invitationToken, host);
  const props = events.find((event) => event.props)?.props;
  const request = props.onAccept({ email: "person@example.test", name: "Taylor", password: "secret" });
  current = false;
  resolveRequest({ verificationSent: true });
  await assert.rejects(request, /invitation page is no longer active/i);
});
