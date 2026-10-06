const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function section(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `expected source section ${startMarker}`);
  return appSource.slice(start, end);
}

test("page-scoped reads recover expired sessions and non-operational actors without swallowing local permission denials", () => {
  const pageRead = section("function pageApi(path, lifetime)", "async function api(path, options)");
  assert.match(pageRead, /error\?\.httpStatus === 401 \|\| \(error\?\.httpStatus === 403 && error\?\.code === "ACCOUNT_NOT_OPERATIONAL"\)/);
  assert.match(pageRead, /isCurrentPageRequest\(lifetime\)[\s\S]*?recoverProtectedCommandFailure\(error\)/);
  assert.match(pageRead, /throw error;/);
});

test("current unread-count auth and non-operational failures recover while stale results stay ignored", () => {
  const refresh = section("async function refreshUnreadNotificationCount()", "function currentWorkspaceDestinations(");
  assert.match(refresh, /generation !== state\.unreadNotificationGeneration \|\| identityEpoch !== state\.identityEpoch \|\| actorPersonId !== state\.actorGrants\?\.actorPersonId/);
  assert.match(refresh, /error\?\.httpStatus === 401 \|\| \(error\?\.httpStatus === 403 && error\?\.code === "ACCOUNT_NOT_OPERATIONAL"\)/);
  assert.match(refresh, /state\.unreadNotificationCount = null;\s*recoverProtectedCommandFailure\(error, \{ identityEpoch, actorPersonId \}\)/);
});

test("saved-view access loss clears cached records before permission/session recovery", () => {
  const loader = section("async function loadSavedTaskViews(", "function taskViewIdentityError(");
  const clearRows = loader.indexOf("state.savedTaskViews = [];");
  const deniedCheck = loader.indexOf("error?.httpStatus === 401 || error?.httpStatus === 403");
  const recover = loader.indexOf("recoverProtectedCommandFailure(error, { identityEpoch, actorPersonId: expectedPersonId })");
  assert.ok(clearRows >= 0 && deniedCheck >= 0 && recover > deniedCheck);
  assert.match(loader.slice(deniedCheck), /state\.savedTaskViewsLoading = false;/);
  assert.match(loader, /state\.savedTaskViewsReadError = true;/);
});

test("appearance writes disable a denied editor and use its captured identity for recovery", () => {
  const save = section("async function saveAppearancePreferences()", "function clearIdentityScopedState(");
  assert.match(save, /const identityContext = \{ identityEpoch, actorPersonId: personId \}/);
  assert.match(save, /error\?\.httpStatus === 401 \|\| error\?\.httpStatus === 403/);
  assert.match(save, /error\.httpStatus === 403[\s\S]*?state\.uiPreferenceWritable = false[\s\S]*?recoverProtectedCommandFailure\(error, identityContext/);
});

test("failed preference reads allow only session preview until saved settings reload successfully", () => {
  const load = section("async function refreshSession()", "function canOpenView(");
  const schedule = section("function scheduleUiPreferenceSave()", "async function reloadUiPreferences()");
  const reload = section("async function reloadUiPreferences()", "async function saveAppearancePreferences()");
  const save = section("async function saveAppearancePreferences()", "function clearIdentityScopedState(");

  assert.match(load, /if \(saved\.readError\)[\s\S]*?personalPreferenceReadStatus\(saved\)/);
  assert.match(load, /saved\.readHttpStatus === 401 \|\| saved\.readHttpStatus === 403/);
  assert.match(schedule, /canPersistPersonalPreferences\(state\.uiPreferenceReadStatus/);
  assert.match(save, /if \(appearanceSaveInFlight \|\| !canPersistPersonalPreferences\(state\.uiPreferenceReadStatus/);
  assert.match(reload, /personId !== state\.uiPreferencePersonId/);
  assert.match(reload, /state\.uiPreferences = \{[\s\S]*?normalizeAppearance\(saved\.appearance\)/);
});

test("grant-derived navigation refreshes when an active browser tab resumes", () => {
  assert.match(appSource, /installPermissionRefreshOnResume\(\{[\s\S]*?readIdentity:[\s\S]*?state\.identityPersonId[\s\S]*?refresh: \(\{ identityEpoch, actorPersonId \}\) => refreshActorPermissions\(identityEpoch, actorPersonId\)/);
});
