const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const webRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");

test("the application host delegates Admin composition with its identity, API, command, and mounting services", () => {
  assert.match(appSource, /import \{ createAdminPageRoute, preloadAdminPageFeatureModules \} from "\.\/app\/admin-page-route\.js"/);
  assert.match(appSource, /const adminPageRoute = createAdminPageRoute\(\{[\s\S]*?state,[\s\S]*?isCurrentPageRequest,[\s\S]*?api,[\s\S]*?runAdminProtectedCommand,/);
  assert.match(appSource, /const adminPageRoute = createAdminPageRoute\(\{[\s\S]*?mountAdminPage,/);
  assert.match(appSource, /const adminPageRoute = createAdminPageRoute\(\{[\s\S]*?showFeedback,\s*renderAdmin,/);
  assert.match(appSource, /async function renderAdminContent\(data, lifetime, preloadedFeatureModules, areaId\) \{\s*return adminPageRoute\(data, lifetime, preloadedFeatureModules, areaId\);\s*\}/);
  assert.match(appSource, /onEffectiveGrantsResolved: \(actorGrants\) => \{\s*preloadedFeatureModules = preloadAdminPageFeatureModules\(\{ actorGrants \}, undefined, areaId\);/);
  assert.match(appSource, /await renderAdminContent\(state\.adminData, lifetime, preloadedFeatureModules, areaId\)/);
  assert.doesNotMatch(appSource, /async function renderAdminContent\(data, lifetime\)[\s\S]*?buildAuthorizedAdminPageSections/);
});

test("Super Admin transfer and Admin retry callbacks use the host's real page renderer", () => {
  assert.match(routeSource, /runAdminProtectedCommand,\s*renderAdmin,\s*adminCommandUiError/);
  assert.match(routeSource, /onRetryRead: \(\) => \{\s*if \(target\.isConnected && isCurrentPageRequest\(lifetime\)\) void renderAdmin\(lifetime\);/);
  assert.doesNotMatch(routeSource, /onRetryRead: \(\) => \{\s*if \(target\.isConnected && isCurrentPageRequest\(lifetime\)\) void loadAdmin\(lifetime\);/);
});

test("Admin feature and route chunks are imported only when their corresponding capability allows them", () => {
  const gatedImports = [
    ["roles", "roleSectionModule", "RolePermissionsSection.tsx"],
    ["organisationStructure", "organizationStructureModule", "OrganizationStructureSection.tsx"],
    ["availabilityConfiguration", "availabilityConfigurationModule", "AvailabilityConfigurationSection.tsx"],
    ["geofence", "officeGeofenceModule", "OfficeGeofenceSettingsSection.tsx"],
    ["attendancePolicy", "attendancePolicyModule", "AttendancePolicySettingsSection.tsx"],
    ["wfhOverrides", "wfhPolicyOverridesModule", "WfhPolicyOverridesSection.tsx"],
    ["leaveReview", "leaveReviewModule", "LeaveRequestsSection.tsx"],
    ["wfhReview", "wfhReviewModule", "WfhRequestsReviewSection.tsx"],
    ["historicalExceptions", "historicalExceptionsModule", "HistoricalExceptionsSection.tsx"],
    ["audit", "auditModule", "AuditEventsSection.tsx"],
    ["notificationDelivery", "notificationDeliveryModule", "NotificationDeliveryOperationsSection.tsx"],
  ];
  for (const [capability, name, module] of gatedImports) {
    assert.match(routeSource, new RegExp(
      `${name}: \\(\\) => import\\("[^"]*${module}"\\)`,
    ), `${module} must stay behind ${capability}`);
    assert.match(routeSource, new RegExp(
      `load\\("${name}", inArea\\("[^"]+"\\) && canShowAdminFeature\\(data\\.actorGrants, "${capability}"\\)\\)`,
    ), `${name} must start only for ${capability}`);
  }
  assert.match(routeSource, /peopleModule: \(\) => import\("\.\.\/src\/features\/admin\/PeopleAdministrationSection\.tsx"\)/);
  assert.match(routeSource, /load\("peopleModule", inArea\("people"\) && \(canInviteAdminPeople\(data\.actorGrants\) \|\| canViewAdminPeople\(data\.actorGrants\)\)\)/);
  assert.match(routeSource, /if \(!authorized\) return Promise\.resolve\(null\)/);
  assert.match(routeSource, /featureLoadFailure\("Office geofencing"\)/);
  assert.match(routeSource, /featureLoadFailure\("Attendance policy"\)/);
  assert.match(routeSource, /featureLoadFailure\("Historical exceptions"\)/);
  assert.match(routeSource, /featureLoadFailure\("Audit history"\)/);
  assert.match(routeSource, /featureLoadFailure\("Notification delivery"\)/);
});

test("command and identity services remain host-owned while route callbacks recheck the current snapshot", () => {
  assert.match(appSource, /runAdminProtectedCommand,[\s\S]{0,100}runAdminRequestReviewCommand,[\s\S]{0,100}saveAdminRole/);
  assert.match(routeSource, /state\.adminData !== data/);
  assert.match(routeSource, /const context = captureCommandContext\(target\)/);
  assert.match(routeSource, /if \(!isCurrentCommand\(context\)\) return;/);
  assert.match(routeSource, /runAdminProtectedCommand\([\s\S]{0,180}"PATCH", "\/api\/organisation\/attendance-policy", request, "Attendance policy scheduled\."/);
  assert.match(routeSource, /"\/api\/historical-exceptions\/" \+ encodeURIComponent\(exceptionId\) \+ "\/resolve"/);
  assert.match(routeSource, /"\/api\/notifications\/delivery\/" \+ encodeURIComponent\(deliveryId\) \+ "\/requeue"/);
});
