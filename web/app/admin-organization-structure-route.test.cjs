const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const webRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
const routeSource = fs.readFileSync(path.join(webRoot, "app", "admin-page-route.js"), "utf8");
const capabilitySource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "capabilities.ts"), "utf8");
const loaderSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-loader.ts"), "utf8");
const compositionSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-sections.ts"), "utf8");
const sectionSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "organization", "OrganizationStructureSection.tsx"), "utf8");
const fallbackSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "organization", "OrganizationStructureFallback.tsx"), "utf8");
const fallbackStyles = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "organization", "OrganizationStructureFallback.module.css"), "utf8");

test("Admin loads Organization Structure only for its grant and composes the typed feature locally", () => {
  assert.match(routeSource, /organizationStructureModule: \(\) => import\("\.\.\/src\/features\/admin\/organization\/OrganizationStructureSection\.tsx"\)/);
  assert.match(routeSource, /load\("organizationStructureModule", canShowAdminFeature\(data\.actorGrants, "organisationStructure"\)\)/);
  assert.match(routeSource, /if \(!target\.isConnected \|\| !isCurrentPageRequest\(lifetime\) \|\| identityEpoch !== state\.identityEpoch \|\| state\.adminData !== data\) return;/);
  assert.match(routeSource, /OrganizationStructureLoadFailureSection,[\s\S]{0,120}RolePermissionsLoadFailureSection/);
  assert.match(routeSource, /"organization-structure": OrganizationStructureSection \? createElement\(OrganizationStructureSection, \{[\s\S]{0,1800}: createElement\(OrganizationStructureLoadFailureSection\)/);
  assert.match(compositionSource, /import \{ OrganizationStructureLoadFailureSection \} from "\.\.\/\.\.\/features\/admin\/organization\/OrganizationStructureFallback"/);
  assert.match(compositionSource, /export \{[^}]*OrganizationStructureLoadFailureSection[^}]*RolePermissionsLoadFailureSection[^}]*\}/);
  assert.doesNotMatch(routeSource, /mountAdminOrganizationStructure|organizationListRead\(/);
  assert.match(sectionSource, /projectOrganizationStructureProps\(props\)/);
  assert.match(sectionSource, /<OrganizationStructureLoadBoundary>[\s\S]{0,250}<OrganizationStructureContent/);
  assert.match(fallbackSource, /<h2[^>]*>Offices and departments<\/h2>/);
  assert.match(fallbackSource, /<StateMessage kind=\{message\.kind\} title=\{message\.title\}>/);
  assert.match(fallbackSource, /function OrganizationStructureLoadFailureSection\(\)/);
  assert.match(fallbackStyles, /color: var\(--nova-color-text-primary\)/);
});

test("existing read plan and API command gates remain organization scoped and unchanged", () => {
  assert.match(capabilitySource, /organisationStructure: Object\.freeze\(\{[\s\S]{0,140}permissionKeys: Object\.freeze\(\["organisation\.settings\.manage"\]\), scopes: organisationScopes/);
  assert.match(capabilitySource, /const organisationSettings = hasPermissionGrant\(read, "organisation\.settings\.manage"\)/);
  assert.match(capabilitySource, /geofenceOptions: hasPermissionGrant\(read, "availability\.office_geofence\.manage"\)/);
  assert.match(loaderSource, /read\(plan\.offices, "\/api\/offices", \{ offices: \[\] \}, "organisation\.settings\.manage"\)/);
  assert.match(loaderSource, /read\(plan\.departments, "\/api\/organisation-departments", \{ departments: \[\] \}, "organisation\.settings\.manage"\)/);

  assert.match(routeSource, /canManageOfficeGeofence: hasAdminPermission\(data, "availability\.office_geofence\.manage"\)/);
  assert.match(routeSource, /onCreateOffice: \(input\) => runAdminProtectedCommand\([\s\S]{0,180}\["organisation\.settings\.manage", "availability\.office_geofence\.manage"\],[\s\S]{0,120}"POST", "\/api\/offices", input, "Office created\."/);
  assert.match(routeSource, /onCreateDepartment: \(input\) => runAdminProtectedCommand\([\s\S]{0,140}"organisation\.settings\.manage", \{\},\s*"POST", "\/api\/organisation-departments", input, "Department created\."/);
  assert.match(appSource, /const requiredPermissions = Array\.isArray\(permission\) \? permission : \[permission\]/);
  assert.match(appSource, /requiredPermissions\.every\(\(key\) => hasAdminPermission\(state\.adminData, key, permissionTarget\)\)/);
  assert.match(appSource, /state\.pendingAdminCommandFocus = true;\s*render\(\);/);
});
