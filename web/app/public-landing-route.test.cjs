const assert = require("node:assert/strict");
const { test } = require("node:test");

const routeModule = import("./public-landing-route.js");

function makeHost(overrides = {}) {
  const events = [];
  const heading = { focus(options) { events.push({ focused: options }); } };
  const target = {
    isConnected: true,
    replaceChildren(element) { events.push({ replacedWith: element }); },
    querySelector(selector) { return selector === "h1" ? heading : null; },
  };
  const host = {
    async loadFeature() { return { Landing: function Landing() {} }; },
    isTargetMounted(candidate) { return candidate === target; },
    isCurrentPageRequest(candidateLifetime) { events.push({ checkedLifetime: candidateLifetime }); return true; },
    mountReactIsland(mountTarget, component, props) { events.push({ mountTarget, component, props }); },
    navigateToSetup() { events.push({ navigation: "setup" }); },
    navigateToSignIn() { events.push({ navigation: "sign-in" }); },
    navigateToInvitation() { events.push({ navigation: "invitation" }); },
    navigateToDeploymentGuide() { events.push({ navigation: "deployment-guide" }); },
    noticeElement(message, kind) { return { message, kind }; },
    ...overrides,
  };
  return { events, heading, host, target };
}

test("public landing mounts its feature and delegates every path to host navigation", async () => {
  const { mountPublicLanding } = await routeModule;
  const { events, heading, host, target } = makeHost();
  const lifetime = { page: 1 };
  await mountPublicLanding(target, lifetime, host);

  const mount = events.find((event) => event.props);
  assert.equal(mount.mountTarget, target);
  assert.equal(mount.component.name, "Landing");
  assert.ok(events.some((event) => event.checkedLifetime === lifetime));
  assert.deepEqual(Object.keys(mount.props).sort(), [
    "onAcceptInvitation", "onDeploymentGuide", "onSetup", "onSignIn",
  ].sort());
  mount.props.onSetup();
  mount.props.onSignIn();
  mount.props.onAcceptInvitation();
  mount.props.onDeploymentGuide();
  assert.deepEqual(events.filter((event) => event.navigation).map((event) => event.navigation), [
    "setup", "sign-in", "invitation", "deployment-guide",
  ]);
  assert.equal(heading.tabIndex, -1);
  assert.ok(events.some((event) => event.focused?.preventScroll === true));

  host.isCurrentPageRequest = () => false;
  mount.props.onSetup();
  assert.equal(events.filter((event) => event.navigation === "setup").length, 1);
});

test("a stale page lifetime or detached target never mounts the lazy feature", async () => {
  const { mountPublicLanding } = await routeModule;
  for (const makeStale of [
    (host) => { host.isCurrentPageRequest = () => false; },
    (_host, target) => { target.isConnected = false; },
    (host) => { host.isTargetMounted = () => false; },
  ]) {
    let featureLoaded = false;
    const { events, host, target } = makeHost({
      async loadFeature() { featureLoaded = true; return { Landing: function Landing() {} }; },
    });
    makeStale(host, target);
    await mountPublicLanding(target, { page: 2 }, host);
    assert.equal(featureLoaded, true);
    assert.equal(events.some((event) => event.props), false);
  }

  let resolveFeature;
  const late = makeHost({
    loadFeature() { return new Promise((resolve) => { resolveFeature = resolve; }); },
  });
  const mounting = mountPublicLanding(late.target, {}, late.host);
  late.host.isCurrentPageRequest = () => false;
  resolveFeature({ Landing: function Landing() {} });
  await mounting;
  assert.equal(late.events.some((event) => event.props), false);
});

test("lazy-load failure shows a host notice only while this page is current", async () => {
  const { mountPublicLanding } = await routeModule;
  const current = makeHost({ async loadFeature() { throw new Error("chunk unavailable"); } });
  await mountPublicLanding(current.target, {}, current.host);
  assert.deepEqual(current.events.find((event) => event.replacedWith)?.replacedWith, {
    message: "NOVA could not load. Reload this page to try again.",
    kind: "error",
  });

  let rejectLoad;
  const stale = makeHost({
    loadFeature() { return new Promise((_resolve, reject) => { rejectLoad = reject; }); },
  });
  const mounting = mountPublicLanding(stale.target, {}, stale.host);
  stale.target.isConnected = false;
  rejectLoad(new Error("chunk unavailable"));
  await mounting;
  assert.equal(stale.events.some((event) => event.replacedWith), false);
});
