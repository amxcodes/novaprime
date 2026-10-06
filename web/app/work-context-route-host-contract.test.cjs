const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const readsSource = fs.readFileSync(path.join(__dirname, "work-read-route.js"), "utf8");
const featureLoaderSource = fs.readFileSync(path.join(__dirname, "work-route-features.js"), "utf8");
const departmentProjectionSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "features", "work-context", "client-department-projection.ts"),
  "utf8",
);
const departmentActionsSource = fs.readFileSync(path.join(__dirname, "work-context-actions-route.ts"), "utf8");

function workRouteSource() {
  const start = appSource.indexOf("async function renderWork(");
  const end = appSource.indexOf("\nasync function runWorkSetupCommand", start);
  assert.ok(start >= 0 && end > start, "renderWork should remain a distinct route host");
  return appSource.slice(start, end);
}

test("Work Context data fetch and explorer presentation keep their independent capability gates", () => {
  const route = workRouteSource();
  const workContextFetches = readsSource.match(/"\/api\/work-context"/g) || [];

  assert.equal(workContextFetches.length, 1, "the host should keep one existing authenticated read");
  assert.match(readsSource, /read\(nonFocusedFeatureReads && readPlan\.workContext,[\s\S]*?"\/api\/work-context"/,
    "the shared context fetch must follow its read plan and the active route");
  assert.match(route, /workContext: readPlan\.workContextView && !taskDetailRoute && !hasReviewRoute && !hasFocusedCollaborationRoute/,
    "the host selects the explorer only for its visible capability and route");
  assert.match(featureLoaderSource, /workContext: \(\) => Promise\.all\(\[\s*import\("\.\.\/src\/features\/work-context\/WorkContextExplorer\.tsx"\),\s*import\("\.\.\/src\/features\/work-context\/client-department-projection\.ts"\),/,
    "the explorer and its department projector load together behind the host selection");
  assert.match(route, /if \(readPlan\.workContextView && !hasReviewRoute && !hasFocusedCollaborationRoute\) \{\s*const workContextHost = workSlot\("context"\);\s*mountWorkContextRoute\(/,
    "the presentation adapter must mount only for the explorer visibility gate");
  assert.match(route, /target: workContextHost,\s*result: workContext,/,
    "the feature receives the host's existing read result");
});

test("Work Context route waits for current page lifetime after reads and lazy feature loading", () => {
  const route = workRouteSource();
  const readBoundary = route.indexOf("= await readWorkRouteData(");
  const loadedFeatureBoundary = route.indexOf("const loadedWorkRouteFeatures = await workRouteFeaturesPromise");
  const mountBoundary = route.indexOf("mountWorkContextRoute({");

  assert.ok(readBoundary >= 0 && loadedFeatureBoundary > readBoundary && mountBoundary > loadedFeatureBoundary);
  assert.match(route.slice(readBoundary, loadedFeatureBoundary), /if \(!isCurrentPageRequest\(lifetime\)\) return;/,
    "stale page reads must stop before feature composition");
  assert.match(route.slice(loadedFeatureBoundary, mountBoundary), /if \(!isCurrentPageRequest\(lifetime\)\) return;/,
    "a late feature import must not mount into a replaced page");
});

test("department creation delegates to the typed action while preserving target checks and guarded transport", () => {
  const route = workRouteSource();
  const mountStart = route.indexOf("mountWorkContextRoute({");
  const mountEnd = route.indexOf("\n    }", mountStart);
  const mount = route.slice(mountStart, mountEnd);

  assert.ok(mountStart >= 0 && mountEnd > mountStart);
  assert.match(mount, /runCommand: createWorkContextDepartmentCommandAction\(\{[\s\S]*?target: workContextHost,[\s\S]*?lifetime,[\s\S]*?getPermissionData: \(\) => \(\{ actorGrants: state\.actorGrants, workContext \}\)/,
    "the action adapter must receive the existing slot, lifetime, and current grant snapshot");
  assert.match(departmentActionsSource, /runWorkSetupCommand\(\s*target,\s*lifetime,/,
    "mutations must remain protected by the shared route target and page lifetime");
  assert.match(departmentActionsSource, /if \(!permission\(getPermissionData\(\)\)\) throw permissionDeniedError\(\)/,
    "the command must recheck the current actor grant against current host context");
  assert.match(departmentActionsSource, /return api\(path, requestOptions\(method, payload\)\)/,
    "the existing authenticated transport and request shaping must remain authoritative");
  assert.match(departmentActionsSource, /setMessage\(successMessage\);[\s\S]*?return result/);
  assert.match(departmentProjectionSource, /`\/api\/clients\/\$\{encodeURIComponent\(clientId\)\}\/departments`/,
    "department creation must keep the existing client-scoped API path");
  assert.match(departmentProjectionSource, /"POST",[\s\S]*?\{ name \},/,
    "the feature projector must preserve the existing POST method and payload boundary");
});
