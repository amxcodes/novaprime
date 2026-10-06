const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

async function loadRoute() {
  return import("./work-route-features.js");
}

function loaderSet(calls, overrides = {}) {
  return Object.fromEntries([
    "taskDetail", "workContext", "reviews", "collaboration", "taskComposer",
    "sessions", "timeline", "assignments", "savedTaskViews", "visibleTasks", "reviewerManagement",
  ].map((feature) => [feature, async () => {
    calls.push(feature);
    if (overrides[feature] instanceof Error) throw overrides[feature];
    return { feature };
  }]));
}

test("loads exactly the feature bundles selected by the host", async () => {
  const { loadWorkRouteFeatures } = await loadRoute();
  const calls = [];
  const features = await loadWorkRouteFeatures({
    assignments: true,
    sessions: false,
    reviews: true,
    unknown: true,
  }, loaderSet(calls));

  assert.deepEqual(calls, ["reviews", "assignments"]);
  assert.deepEqual(features.reviews, { feature: "reviews" });
  assert.equal(features.assignments.feature, "assignments");
  assert.equal(features.sessions, null);
  assert.equal(Object.prototype.hasOwnProperty.call(features, "unknown"), false);
});

test("starts enabled feature imports concurrently", async () => {
  const { loadWorkRouteFeatures } = await loadRoute();
  const calls = [];
  const features = await loadWorkRouteFeatures({ timeline: true, visibleTasks: true }, loaderSet(calls));

  assert.deepEqual(calls, ["timeline", "visibleTasks"]);
  assert.deepEqual(features.timeline, { feature: "timeline" });
  assert.deepEqual(features.visibleTasks, { feature: "visibleTasks" });
});

test("isolates a failed feature chunk while retaining other loaded bundles", async () => {
  const { loadWorkRouteFeatures } = await loadRoute();
  const calls = [];
  const chunkError = new Error("chunk failed");
  const features = await loadWorkRouteFeatures({ reviews: true, taskComposer: true }, loaderSet(calls, {
    reviews: chunkError,
  }));

  assert.deepEqual(calls, ["reviews", "taskComposer"]);
  assert.equal(features.reviews.error, chunkError);
  assert.deepEqual(features.taskComposer, { feature: "taskComposer" });
});

test("rejects invalid host selection instead of loading every feature by accident", async () => {
  const { loadWorkRouteFeatures } = await loadRoute();
  let called = false;
  await assert.rejects(
    loadWorkRouteFeatures(null, { feature: async () => { called = true; } }),
    /selection is required/,
  );
  assert.equal(called, false);
});

test("the legacy Work host keeps grant and route gates, passing only selected imports to the loader", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const route = app.slice(app.indexOf("async function renderWork("), app.indexOf("function workSetupPermission("));

  assert.match(app, /import \{ loadWorkRouteFeatures \} from "\.\/app\/work-route-features\.js"/);
  assert.match(app, /resolveWorkRouteContext,/);
  assert.match(route, /const readPlan = planWorkReads\(state\.actorGrants/);
  assert.match(route, /const canCreateTasks = hasAnyPermissionGrant\(state\.actorGrants, \["tasks\.create"\]/);
  assert.match(route, /const canActOnTasks = hasAnyPermissionGrant\(state\.actorGrants/);
  assert.match(route, /const workRouteContext = resolveWorkRouteContext\(\{/);
  assert.match(route, /focusedCollaboration: focusedRouteInput/);
  assert.match(route, /const workRouteFeaturesPromise = loadWorkRouteFeatures\(featureImports\)/);
  const perFeatureImports = /const (?:taskDetail|workContext|reviews|workCollaboration|taskComposer|sessions|timeline|myAssignments|savedTaskViews|visibleTasks|reviewerManagement)UiPromise\s*=/;
  assert.doesNotMatch(route, perFeatureImports);
  assert.match(route, /workRouteFeatures\.taskDetail/);
  assert.match(route, /loadedWorkRouteFeatures\.workContext/);
  assert.match(route, /loadedWorkRouteFeatures\.reviews/);
});

test("starts only valid Work route reads before waiting for the page UI chunk", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const route = app.slice(app.indexOf("async function renderWork("), app.indexOf("function workSetupPermission("));
  const readStart = route.indexOf("const workReadDataPromise =");
  const uiWait = route.indexOf("const loadedWorkPageUi = await workPageUiPromise");
  const readPlanBlock = route.slice(readStart, uiWait);

  assert.ok(readStart >= 0 && uiWait > readStart);
  assert.match(readPlanBlock, /!taskDetailRoute && !workRouteUnavailableMessage/,
    "task-detail and invalid focused routes must not start the standard Work reads");
  assert.match(readPlanBlock, /readWorkRouteData\(\{[\s\S]*?lifetime,[\s\S]*?pageApi,/,
    "the early reads must retain their authenticated transport and cancellable page lifetime");
});
