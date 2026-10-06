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

test("session readiness overlaps the independent grants and self-preference reads but still gates preference application", () => {
  const session = section("async function refreshSession()", "function canOpenView(");
  const sessionRead = session.indexOf('await fetch("/api/auth/get-session"');
  const parallelReads = session.indexOf("const [grants, saved] = await Promise.all([");
  const grantsRead = session.indexOf('api("/api/me/permission-grants")', parallelReads);
  const preferencesRead = session.indexOf('api("/api/me/ui-preferences")', parallelReads);
  const grantsGate = session.indexOf("if (grants.readError || !grants.actorPersonId)", parallelReads);
  const preferenceStatus = session.indexOf("if (saved.readError)", parallelReads);

  assert.ok(sessionRead >= 0 && parallelReads > sessionRead && grantsRead > parallelReads && preferencesRead > grantsRead);
  assert.ok(grantsGate > preferencesRead && preferenceStatus > grantsGate);
  assert.match(session, /saved\.personId !== grants\.actorPersonId/);
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

test("saved views stay off session readiness and load on the Work or Settings surface", () => {
  const session = section("async function refreshSession()", "function canOpenView(");
  const work = section("async function renderWork(date, lifetime)", "async function renderWorkSetup(lifetime)");
  const settings = section("async function updateSavedTaskViewsEditor()", "async function renderAppearanceEditor()");
  const loader = section("async function loadSavedTaskViews(", "function taskViewIdentityError(");

  assert.doesNotMatch(session, /loadSavedTaskViews|ensureSavedTaskViewsLoaded|\/api\/me\/task-views/);
  assert.match(work, /featureImports\.savedTaskViews && requestedActorId[\s\S]*?ensureSavedTaskViewsLoaded\(requestedActorId, requestIdentityEpoch\)/);
  assert.match(work, /Promise\.all\(\[[\s\S]*?readWorkRouteData\([\s\S]*?savedTaskViewsRead/);
  assert.match(settings, /ensureSavedTaskViewsLoaded\(personId, identityEpoch\)/);
  assert.match(settings, /const personId = state\.identityPersonId \|\| state\.actorGrants\?\.actorPersonId \|\| null/);
  assert.match(settings, /if \(personId && allowedCollections\.length > 0 && !state\.savedTaskViewsLoaded/);
  assert.match(settings, /isCurrentSavedTaskViewsEditor\(target, generation, identityEpoch\)/);
  assert.match(loader, /state\.savedTaskViewsLoading && pending\?\.personId === expectedPersonId && pending\.identityEpoch === identityEpoch/);
  assert.match(loader, /state\.savedTaskViewsLoaded = true;/);
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
