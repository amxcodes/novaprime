const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const webRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
const routeSource = fs.readFileSync(path.join(webRoot, "app", "admin-page-route.js"), "utf8");
const capabilitiesSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "capabilities.ts"), "utf8");
const pageSectionsSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-sections.ts"), "utf8");
const wrapperSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "roles", "RolePermissionsSection.tsx"), "utf8");
const loadFailureSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "roles", "RolePermissionsLoadFailureSection.tsx"), "utf8");
const contentSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "roles", "RolePermissionsEditorContent.tsx"), "utf8");
const editorSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "roles", "RolePermissionsEditor.tsx"), "utf8");
const matrixSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "roles", "PermissionGrantMatrix.tsx"), "utf8");

test("Admin wires Roles as a typed lazy child using the existing independent reads", () => {
  assert.match(routeSource, /preloadedFeatureModules \?\? preloadAdminPageFeatureModules\(data\)/);
  assert.match(routeSource, /roleSectionModule: \(\) => import\("\.\.\/src\/features\/admin\/roles\/RolePermissionsSection\.tsx"\)/);
  assert.match(routeSource, /roleScopeTargetsRouteModule: \(\) => import\("\.\/admin-role-scope-targets-route\.js"\)/);
  assert.match(routeSource, /load\("roleSectionModule", canShowAdminFeature\(data\.actorGrants, "roles"\)\)/);
  assert.match(routeSource, /load\("roleScopeTargetsRouteModule", canShowAdminFeature\(data\.actorGrants, "roles"\)\)/);
  assert.match(routeSource, /if \(!target\.isConnected \|\| !isCurrentPageRequest\(lifetime\) \|\| identityEpoch !== state\.identityEpoch \|\| state\.adminData !== data\) return;/);
  assert.match(routeSource, /const \{[^}]*buildAuthorizedAdminPageSections[^}]*RolePermissionsLoadFailureSection[^}]*\} = adminPageSections;/);
  assert.match(routeSource, /const RolePermissionsSection = roleSectionModule\?\.RolePermissionsSection;/);
  assert.match(routeSource, /roles: RolePermissionsSection \? createElement\(RolePermissionsSection, \{/);
  assert.match(routeSource, /canView: hasAdminPermission\(data, "roles\.view"\)/);
  assert.match(routeSource, /canCreate: hasAdminPermission\(data, "roles\.create"\)/);
  assert.match(routeSource, /canEdit: hasAdminPermission\(data, "roles\.edit"\)/);
  assert.match(routeSource, /createAdminRoleScopeTargetsRoute\(\{[\s\S]{0,500}hasAdminPermission,[\s\S]{0,160}pageApi,/);
  assert.match(routeSource, /onSearchTargets: hasAdminPermission\(data, "roles\.view"\) \? searchRoleScopeTargets : undefined/);
  assert.match(routeSource, /roles: \{ result: data\.roles, issue: adminReadIssue\(data\.roles, "roles"\) \}/);
  assert.match(routeSource, /issue: adminReadIssue\(data\.permissions, "the role permission catalogue"\)/);
  assert.doesNotMatch(routeSource, /renderRolePermissionsEditor|rolePermissionsRoot/);
  assert.match(routeSource, /roles: RolePermissionsSection \? createElement\(RolePermissionsSection,[\s\S]{0,4000}: createElement\(RolePermissionsLoadFailureSection\)/);
  assert.match(pageSectionsSource, /import \{ RolePermissionsLoadFailureSection \} from "\.\.\/\.\.\/features\/admin\/roles\/RolePermissionsLoadFailureSection"/);
  assert.match(pageSectionsSource, /export \{[^}]*RolePermissionsLoadFailureSection[^}]*\}/);
  assert.match(loadFailureSource, /<StateMessage[^>]*kind="error"/);
  assert.match(loadFailureSource, /<h2[^>]*>Roles and permissions<\/h2>/);
  assert.match(wrapperSource, /class RolePermissionsLoadBoundary extends Component/);
  assert.match(wrapperSource, /<RolePermissionsLoadBoundary>[\s\S]*<Suspense fallback=\{<StateMessage kind="loading" title="Loading role and permission controls" \/>\}>/);
  assert.doesNotMatch(appSource, /rolePermissionsLoadFailureSection|className: "feature-section"/);
  assert.match(capabilitiesSource, /rolesView && hasAnyPermissionGrant\(read, \["roles\.create", "roles\.edit"\], \["organisation"\]\)/);
  assert.match(capabilitiesSource, /permissions: rolesView,[\s\S]{0,80}roles: rolesView/);
  assert.doesNotMatch(capabilitiesSource, /roles\.assign/);
});

test("role editor preserves independent target-read availability and uses a feature-owned safe projector", () => {
  assert.match(routeSource, /office: \{[\s\S]{0,220}result: data\.offices,[\s\S]{0,200}rows: data\.offices\?\.offices/);
  assert.match(routeSource, /organisation_department: \{[\s\S]{0,240}result: data\.departments,[\s\S]{0,220}rows: data\.departments\?\.departments/);
  assert.match(routeSource, /client_workstream: \{[\s\S]{0,230}result: data\.workContext,[\s\S]{0,220}rows: data\.workContext\?\.clientWorkstreams/);
  assert.match(contentSource, /projectRolePermissionsEditorProps\(props\)/);
  assert.match(wrapperSource, /lazy\(\(\) =>\s*import\("\.\/RolePermissionsEditorContent"\)/);
  assert.match(wrapperSource, /StateMessage kind="loading" title="Loading role and permission controls"/);
  assert.match(wrapperSource, /Role and permission controls could not load\. Reload Admin to try again\./);
  assert.match(wrapperSource, /<h2[^>]*>Roles and permissions<\/h2>/);
  assert.match(matrixSource, /targetRead\.status !== "ready"/);
  assert.match(matrixSource, /targetRead\?\.status === "ready"/);
});

test("create and update keep their exact endpoints, revision payload, fresh grants, and stale-data guard", () => {
  const commandMatch = appSource.match(/async function saveAdminRole\([\s\S]*?\r?\n\}/);
  assert.ok(commandMatch);
  const command = commandMatch[0];

  assert.match(command, /state\.adminData !== currentData/);
  assert.match(command, /action === "create" \? "roles\.create" : "roles\.edit"/);
  assert.match(command, /hasAdminPermission\(state\.adminData, permission\)/);
  assert.match(command, /update \? "\/api\/roles\/" \+ encodeURIComponent\(roleId\) : "\/api\/roles"/);
  assert.match(command, /"\/api\/roles\/" \+ encodeURIComponent\(roleId\)/);
  assert.match(command, /requestOptions\(update \? "PATCH" : "POST", payload\)/);
  assert.match(command, /captureCommandContext\(target\)/);
  assert.match(command, /isCurrentCommandIdentity\(context\)/);
  assert.match(command, /isCurrentCommand\(context\)/);

  assert.match(editorSource, /expectedRevision: draft\.expectedRevision \|\| 1/);
  assert.match(editorSource, /if \(!props\.canEdit \|\| role\.isProtected \|\| role\.archivedAt\) return/);
  assert.match(editorSource, /props\.canEdit && !role\.isProtected && !role\.archivedAt/);
  assert.doesNotMatch(editorSource, /roles\.assign/);
});

test("role editor avoids late state updates when the host refresh remounts Admin", () => {
  assert.match(editorSource, /const mountedRef = useRef\(false\)/);
  assert.match(editorSource, /mountedRef\.current = true;\s*return \(\) => \{\s*mountedRef\.current = false;/);
  assert.match(editorSource, /await props\.onCreate\(payload\);\s*\}\s*if \(mountedRef\.current\) resetDraft\(\);/);
  assert.match(editorSource, /catch \(saveError\) \{\s*if \(!mountedRef\.current\) return;/);
  assert.match(editorSource, /if \(mountedRef\.current\) setSubmitting\(false\);/);
});
