const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { resolveAdminNotificationFocus } = require("./admin-notification-focus.js");

const leaveId = "11111111-1111-4111-8111-111111111111";
const wfhId = "22222222-2222-4222-8222-222222222222";
const grantFeature = (allowed) => (_grants, feature) => allowed.includes(feature);

test("Admin notification focus requires the exact feature grant and one matching request ID", () => {
  assert.deepEqual(
    resolveAdminNotificationFocus(`?view=admin&focus=leave-review&leave=${leaveId}`, {}, grantFeature(["leaveReview"])),
    { kind: "leave", requestId: leaveId },
  );
  assert.deepEqual(
    resolveAdminNotificationFocus(`?view=admin&focus=wfh-review&wfh=${wfhId}`, {}, grantFeature(["wfhReview"])),
    { kind: "wfh", requestId: wfhId },
  );
  assert.equal(resolveAdminNotificationFocus(`?view=admin&focus=leave-review&leave=${leaveId}`, {}, grantFeature([])), null);
  assert.equal(resolveAdminNotificationFocus(`?view=admin&focus=wfh-review&wfh=${wfhId}`, {}, grantFeature(["leaveReview"])), null);
});

test("invalid, duplicate, mismatched, and non-Admin focus parameters fail closed", () => {
  for (const search of [
    `?view=admin&focus=leave-review&leave=bad`,
    `?view=admin&focus=leave-review&leave=${leaveId}&leave=${wfhId}`,
    `?view=admin&focus=leave-review&wfh=${wfhId}`,
    `?view=admin&focus=leave-review&leave=${leaveId}&wfh=${wfhId}`,
    `?view=admin&view=today&focus=leave-review&leave=${leaveId}`,
    `?view=admin&focus=leave-review&focus=wfh-review&leave=${leaveId}`,
    `?view=today&focus=leave-review&leave=${leaveId}`,
  ]) {
    assert.equal(resolveAdminNotificationFocus(search, {}, grantFeature(["leaveReview", "wfhReview"])), null, search);
  }
});

test("Admin host passes notification event keys and only authorized parsed focus into each typed review feature", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const routeSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");
  assert.match(source, /resolveNotificationDeepLink:\s*\(rawDeepLink,\s*eventKey\)\s*=>/);
  assert.match(source, /homeView:\s*workspaceHomeView\(\),\s*eventKey,/);
  assert.match(routeSource, /resolveAdminNotificationFocus\(\s*window\.location\.search,\s*data\.actorGrants,\s*canShowAdminFeature,?\s*\)/);
  assert.match(routeSource, /focusRequestId: adminNotificationFocus\?\.kind === "leave" \? adminNotificationFocus\.requestId : null/);
  assert.match(routeSource, /focusRequestId: adminNotificationFocus\?\.kind === "wfh" \? adminNotificationFocus\.requestId : null/);
  assert.match(routeSource, /"leave-review": LeaveRequestsSection\s*\? createElement\(LeaveRequestsSection, leaveReviewProps\)/);
  assert.match(routeSource, /"wfh-review": WfhRequestsReviewSection\s*\? createElement\(WfhRequestsReviewSection, wfhReviewProps\)/);
  assert.doesNotMatch(routeSource, /mountAdminLeaveRequests|mountAdminWfhRequestsReview/);
});
