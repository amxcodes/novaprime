const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const webRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
const routeSource = fs.readFileSync(path.join(webRoot, "app", "admin-page-route.js"), "utf8");
const capabilitiesSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "capabilities.ts"), "utf8");
const loaderSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-loader.ts"), "utf8");
const sectionsSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-sections.ts"), "utf8");
const leaveWrapperSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "leave-requests", "LeaveRequestsSection.tsx"), "utf8");
const wfhWrapperSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "wfh-requests", "WfhRequestsReviewSection.tsx"), "utf8");
const leaveProjectionSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "leave-requests", "projection.ts"), "utf8");
const wfhProjectionSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "wfh-requests", "projection.ts"), "utf8");
const leaveComponentSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "leave-requests", "LeaveRequests.tsx"), "utf8");
const wfhComponentSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "wfh-requests", "WfhRequestsReview.tsx"), "utf8");

test("Admin loads Leave and WFH review as independent grant-filtered React children", () => {
  assert.match(routeSource, /leaveReviewModule: \(\) => import\("\.\.\/src\/features\/admin\/leave-requests\/LeaveRequestsSection\.tsx"\)/);
  assert.match(routeSource, /wfhReviewModule: \(\) => import\("\.\.\/src\/features\/admin\/wfh-requests\/WfhRequestsReviewSection\.tsx"\)/);
  assert.match(routeSource, /load\("leaveReviewModule", canShowAdminFeature\(data\.actorGrants, "leaveReview"\)\)/);
  assert.match(routeSource, /load\("wfhReviewModule", canShowAdminFeature\(data\.actorGrants, "wfhReview"\)\)/);
  assert.match(routeSource, /identityEpoch !== state\.identityEpoch \|\| state\.adminData !== data/);
  assert.match(routeSource, /LeaveRequestsSection = canShowAdminFeature\(\s*state\.adminData\?\.actorGrants,\s*"leaveReview"/);
  assert.match(routeSource, /WfhRequestsReviewSection = canShowAdminFeature\(\s*state\.adminData\?\.actorGrants,\s*"wfhReview"/);
  assert.match(routeSource, /"leave-review": LeaveRequestsSection\s*\? createElement\(LeaveRequestsSection, leaveReviewProps\)\s*: createElement\(LeaveRequestsLoadFailureSection\)/);
  assert.match(routeSource, /"wfh-review": WfhRequestsReviewSection\s*\? createElement\(WfhRequestsReviewSection, wfhReviewProps\)\s*: createElement\(WfhRequestsReviewLoadFailureSection\)/);
  assert.match(sectionsSource, /LeaveRequestsLoadFailureSection/);
  assert.match(sectionsSource, /WfhRequestsReviewLoadFailureSection/);
  assert.doesNotMatch(routeSource, /mountAdminLeaveRequests|mountAdminWfhRequestsReview|adminLeaveRequestsRoot|adminWfhRequestsRoot/);
  assert.match(leaveWrapperSource, /projectLeaveRequestsProps\(props\)/);
  assert.match(leaveWrapperSource, /<Suspense fallback=\{<LeaveRequestsFallback loading \/>\}>/);
  assert.match(wfhWrapperSource, /projectWfhRequestsReviewProps\(props\)/);
  assert.match(wfhWrapperSource, /<Suspense fallback=\{<WfhRequestsReviewFallback loading \/>\}>/);
});

test("review discovery, queue reads, command guards, and notification targets remain unchanged", () => {
  assert.match(capabilitiesSource, /leaveReview: Object\.freeze\(\{[\s\S]{0,500}permissionKeys: Object\.freeze\(\["leave\.review"\]\),[\s\S]{0,500}scopes: Object\.freeze\(\["organisation", "office", "organisation_department"\]\)/);
  assert.match(capabilitiesSource, /wfhReview: Object\.freeze\(\{[\s\S]{0,300}permissionKeys: Object\.freeze\(\["availability\.wfh\.review"\]\),[\s\S]{0,220}scopes: Object\.freeze\(\["organisation", "office", "organisation_department"\]\)/);
  assert.match(loaderSource, /read\(plan\.leavePending, "\/api\/leave\/pending"/);
  assert.match(loaderSource, /read\(plan\.wfhPending, "\/api\/availability\/wfh\/pending"/);
  assert.match(routeSource, /focusRequestId: adminNotificationFocus\?\.kind === "leave" \? adminNotificationFocus\.requestId : null/);
  assert.match(routeSource, /focusRequestId: adminNotificationFocus\?\.kind === "wfh" \? adminNotificationFocus\.requestId : null/);
  assert.match(routeSource, /canRenderRequestReviewActions\(request\) \|\| request\.hasConflict === true/);
  assert.match(routeSource, /canRenderLeaveConflictAction\(request\)/);
  assert.match(leaveProjectionSource, /canResolveConflict: value\.hasConflict && value\.canReview === true && value\.canResolveConflict === true/);
  assert.match(leaveComponentSource, /Conflicted requests can only use the recovery path/);
  assert.match(wfhProjectionSource, /canReview: value\.canReview === true/);
  assert.match(wfhComponentSource, /actionEligibility\.allowed \? \(/);
  assert.match(wfhComponentSource, /request\.canReview/);

  const command = appSource.match(/async function runAdminRequestReviewCommand\([\s\S]*?\r?\n\}/)?.[0] || "";
  assert.match(command, /!target\.isConnected \|\| !isCurrentPageRequest\(lifetime\) \|\| state\.adminData !== data/);
  assert.match(command, /captureCommandContext\(target\)/);
  assert.match(command, /isCurrentCommandIdentity\(context\)/);
  assert.match(command, /isCurrentCommand\(context\)/);
  assert.match(command, /requestOptions\("POST", payload\)/);
  assert.match(routeSource, /"\/api\/leave\/" \+ encodeURIComponent\(requestId\) \+ "\/review"[\s\S]{0,100}\{ decision \}/);
  assert.match(routeSource, /"\/api\/leave\/" \+ encodeURIComponent\(requestId\) \+ "\/resolve-conflict"[\s\S]{0,100}\{ decision, note \}/);
  assert.match(routeSource, /"\/api\/availability\/wfh\/" \+ encodeURIComponent\(requestId\) \+ "\/review"/);
  assert.match(routeSource, /typeof command\.reason === "string" && command\.reason\.trim\(\)[\s\S]{0,80}reason: command\.reason\.trim\(\)/);
});
