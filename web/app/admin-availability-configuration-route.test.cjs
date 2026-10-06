const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const webRoot = path.join(__dirname, "..");
const routeSource = fs.readFileSync(path.join(webRoot, "app", "admin-page-route.js"), "utf8");
const capabilitySource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "capabilities.ts"), "utf8");
const loaderSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-loader.ts"), "utf8");
const compositionSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-sections.ts"), "utf8");
const sectionSource = fs.readFileSync(path.join(webRoot, "src", "features", "availability", "AvailabilityConfigurationSection.tsx"), "utf8");
const projectionSource = fs.readFileSync(path.join(webRoot, "src", "features", "availability", "admin-configuration-projection.ts"), "utf8");
const fallbackSource = fs.readFileSync(path.join(webRoot, "src", "features", "availability", "AvailabilityConfigurationFallback.tsx"), "utf8");

test("Admin loads Availability only for its organization grant and composes its typed feature child", () => {
  assert.match(routeSource, /availabilityConfigurationModule: \(\) => import\("\.\.\/src\/features\/availability\/AvailabilityConfigurationSection\.tsx"\)/);
  assert.match(routeSource, /availabilityPickerSearchModule: \(\) => import\("\.\/admin-availability-picker-search-route\.js"\)/);
  assert.match(routeSource, /load\("availabilityConfigurationModule", canShowAdminFeature\(data\.actorGrants, "availabilityConfiguration"\)\)/);
  assert.match(routeSource, /load\("availabilityPickerSearchModule", canShowAdminFeature\(data\.actorGrants, "availabilityConfiguration"\)\)/);
  assert.match(routeSource, /createAvailabilityPickerSearchRoute\(\{[\s\S]{0,300}pageApi,[\s\S]{0,120}captureCommandContext/);
  assert.match(routeSource, /if \(!target\.isConnected \|\| !isCurrentPageRequest\(lifetime\) \|\| identityEpoch !== state\.identityEpoch \|\| state\.adminData !== data\) return;/);
  assert.match(routeSource, /const AvailabilityConfigurationSection = canShowAdminFeature\(\s*state\.adminData\?\.actorGrants,\s*"availabilityConfiguration",\s*\)/);
  assert.match(routeSource, /AvailabilityConfigurationLoadFailureSection,[\s\S]{0,130}OrganizationStructureLoadFailureSection/);
  assert.match(routeSource, /"availability-configuration": AvailabilityConfigurationSection\s*\? createElement\(AvailabilityConfigurationSection, availabilityConfigurationProps\)\s*: createElement\(AvailabilityConfigurationLoadFailureSection\)/);
  assert.match(compositionSource, /import \{ AvailabilityConfigurationLoadFailureSection \} from "\.\.\/\.\.\/features\/availability\/AvailabilityConfigurationFallback"/);
  assert.match(compositionSource, /export \{[\s\S]{0,100}AvailabilityConfigurationLoadFailureSection/);
  assert.match(sectionSource, /projectAvailabilityConfigurationProps\(props\)/);
  assert.match(sectionSource, /<Suspense fallback=\{<AvailabilityConfigurationFallback state="loading" \/>\}>/);
  assert.match(sectionSource, /<AvailabilityConfigurationLoadBoundary>/);
  assert.match(fallbackSource, /Availability configuration could not load/);
  assert.match(fallbackSource, /<h2[^>]*>Availability configuration<\/h2>/);
  assert.doesNotMatch(routeSource, /renderAvailabilitySection|mountAdminAvailabilityConfiguration|adminAvailabilityConfigurationRoot/);
});

test("resource visibility and create commands retain their existing grant and API contracts", () => {
  assert.match(capabilitySource, /availabilityConfiguration: Object\.freeze\(\{[\s\S]{0,300}permissionKeys: Object\.freeze\(\[[\s\S]{0,180}"availability\.holiday\.manage"[\s\S]{0,80}scopes: organisationScopes/);
  assert.match(capabilitySource, /availability: hasAnyPermissionGrant\(read, \[[\s\S]{0,280}"availability\.holiday\.manage"[\s\S]{0,90}\], \["organisation"\]\)/);
  assert.match(loaderSource, /read\(plan\.availability, "\/api\/availability\/config"/);
  assert.match(routeSource, /canReadOffices: hasAdminPermission\(data, "organisation\.settings\.manage"\)/);
  assert.match(routeSource, /searchOffices: availabilityPickerSearchRoute\?\.searchOffices/);
  assert.match(routeSource, /searchShifts: availabilityPickerSearchRoute\?\.searchShifts/);
  assert.match(routeSource, /shiftTargets:[\s\S]{0,220}hasAdminPermission\(data, "availability\.shift\.view"\)[\s\S]{0,180}hasAdminPermission\(data, "availability\.calendar\.manage"\)/);
  assert.match(routeSource, /const createAvailabilityConfiguration = async \(permission, path, input, successMessage\) => \{[\s\S]{0,850}state\.adminData !== data[\s\S]{0,400}hasAdminPermission\(state\.adminData, permission\)/);
  assert.match(routeSource, /"availability\.shift\.manage",\s*"\/api\/availability\/shifts",\s*input,\s*"Shift created\."/);
  assert.match(routeSource, /"availability\.calendar\.manage",\s*"\/api\/availability\/calendars",\s*input,\s*"Working calendar created and assigned to the office\."/);
  assert.match(routeSource, /"availability\.holiday\.manage",\s*"\/api\/availability\/holidays",\s*input,\s*"Holiday added\."/);
  assert.match(routeSource, /await api\(path, requestOptions\("POST", input\)\)/);
  assert.match(routeSource, /captureCommandContext\(target\)/);
  assert.match(routeSource, /recoverProtectedCommandFailure\(error, context\)/);
  assert.match(projectionSource, /projectOffice\(value: unknown\): AvailabilityOfficeOption/);
  assert.match(projectionSource, /function projectRule\(value: unknown\): AvailabilityCalendarRule \| null/);
  assert.match(projectionSource, /input\.canReadOffices[\s\S]{0,220}Office choices are unavailable under your current access/);
});
