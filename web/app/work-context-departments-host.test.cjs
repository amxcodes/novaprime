const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("Work keeps shared context fetching and visible explorer mounting independently gated", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const reads = fs.readFileSync(path.join(__dirname, "work-read-route.js"), "utf8");
  const routeStart = app.indexOf("async function renderWork(");
  const routeEnd = app.indexOf("\nasync function runWorkSetupCommand", routeStart);
  const route = app.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(app, /await readWorkRouteData\(\{[\s\S]*?readPlan,[\s\S]*?pageApi,/);
  assert.match(reads, /read\(nonFocusedFeatureReads && readPlan\.workContext,[\s\S]*?"\/api\/work-context"/);
  assert.match(route, /if \(readPlan\.workContextView && !hasReviewRoute && !hasFocusedCollaborationRoute\) \{[\s\S]*?mountWorkContextRoute\(/);
  assert.equal((reads.match(/"\/api\/work-context"/g) || []).length, 1);
});

test("department commands use the typed host adapter and shared authenticated command guard", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const routeStart = app.indexOf("async function renderWork(");
  const routeEnd = app.indexOf("\nasync function runWorkSetupCommand", routeStart);
  const route = app.slice(routeStart, routeEnd);
  const action = fs.readFileSync(path.join(__dirname, "work-context-actions-route.ts"), "utf8");

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(app, /import \{ createWorkContextDepartmentCommandAction \} from "\.\/app\/work-context-actions-route\.ts"/);
  assert.match(route, /runCommand: createWorkContextDepartmentCommandAction\(\{[\s\S]*?target: workContextHost,[\s\S]*?lifetime,[\s\S]*?getPermissionData: \(\) => \(\{ actorGrants: state\.actorGrants, workContext \}\)/);
  assert.match(route, /runWorkSetupCommand,[\s\S]*?api,[\s\S]*?requestOptions,[\s\S]*?permissionDeniedError: \(\) => workSetupSafeError\(\{ code: "PERMISSION_DENIED" \}\),[\s\S]*?setMessage,/);
  assert.match(action, /if \(!permission\(getPermissionData\(\)\)\) throw permissionDeniedError\(\)/);
  assert.match(action, /return api\(path, requestOptions\(method, payload\)\)/);
  assert.match(action, /setMessage\(successMessage\);[\s\S]*?return result/);
});
