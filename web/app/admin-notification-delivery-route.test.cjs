const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const routeSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");
const loaderSource = fs.readFileSync(path.join(__dirname, "..", "src", "pages", "admin", "admin-page-loader.ts"), "utf8");
const capabilitySource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "admin", "capabilities.ts"), "utf8");
const sectionSource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "notifications", "delivery-operations", "NotificationDeliveryOperationsSection.tsx"), "utf8");
const { canShowAdminFeature, planAdminReads } = require("../src/features/admin/capabilities.ts");
const { projectNotificationDeliveryReadState } = require("../src/features/notifications/delivery-operations/projection.ts");

test("Admin GET and typed section are planned only by organization-scoped delivery-view permission", () => {
  assert.match(capabilitySource, /notificationDelivery:\s*Object\.freeze\(\{[\s\S]*?permissionKeys:\s*Object\.freeze\(\["notifications\.delivery\.view"\]\),\s*scopes:\s*organisationScopes/);
  assert.match(capabilitySource, /notificationDelivery:\s*hasPermissionGrant\(read, "notifications\.delivery\.view"\)/);
  assert.match(loaderSource, /read\(plan\.notificationDelivery,\s*"\/api\/notifications\/delivery\?limit=50"/);
  assert.match(routeSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "notificationDelivery"\), \(\) => import\("\.\.\/src\/features\/notifications\/delivery-operations\/NotificationDeliveryOperationsSection\.tsx"\)\)/);
  assert.match(routeSource, /"notification-delivery": NotificationDeliveryOperations \? createElement\(NotificationDeliveryOperations/);

  const manageOnly = { grants: [{ permissionKey: "notifications.manage", scope: "organisation" }] };
  assert.equal(planAdminReads(manageOnly).notificationDelivery, false);
  assert.equal(canShowAdminFeature(manageOnly, "notificationDelivery"), false);

  const viewOnly = { grants: [{ permissionKey: "notifications.delivery.view", scope: "organisation" }] };
  assert.equal(planAdminReads(viewOnly).notificationDelivery, true);
  assert.equal(canShowAdminFeature(viewOnly, "notificationDelivery"), true);
});

test("delivery projection is safe and preserves the bounded view contract", () => {
  const read = projectNotificationDeliveryReadState({
    deliveries: [{
      id: "delivery-1",
      eventKey: "task.assigned",
      status: "failed",
      attempts: 2,
      availableAt: "2026-10-04T08:00:00.000Z",
      createdAt: "2026-10-04T07:00:00.000Z",
      sentAt: null,
      recipientPersonId: "private-person-id",
      providerMessageId: "private-provider-id",
      lastError: "private-provider-error",
      internalPayload: { token: "private-payload" },
    }, { id: "  " }, { eventKey: "invalid" }],
    total: 999,
  });

  assert.deepEqual(read, {
    status: "ready",
    limit: 50,
    deliveries: [{
      id: "delivery-1",
      eventKey: "task.assigned",
      status: "failed",
      attempts: 2,
      availableAt: "2026-10-04T08:00:00.000Z",
      createdAt: "2026-10-04T07:00:00.000Z",
      sentAt: null,
    }],
  });
  assert.doesNotMatch(JSON.stringify(read), /private-person-id|private-provider-id|private-provider-error|private-payload|total/);
});

test("delivery projection keeps bounded failure and malformed-response states", () => {
  assert.deepEqual(projectNotificationDeliveryReadState(null, {
    status: "unavailable",
    message: "Delivery attempts are unavailable.",
  }), { status: "failed", message: "Delivery attempts are unavailable." });
  assert.deepEqual(projectNotificationDeliveryReadState({ deliveries: "bad" }), {
    status: "failed",
    message: "The delivery response could not be read. Refresh Admin to try again.",
  });
});

test("requeue keeps view and manage grants independent and host-owned guards intact", () => {
  const sectionStart = routeSource.indexOf('"notification-delivery": NotificationDeliveryOperations ? createElement(NotificationDeliveryOperations');
  const sectionEnd = routeSource.indexOf(': featureLoadFailure("Notification delivery")', sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const section = routeSource.slice(sectionStart, sectionEnd);

  assert.match(section, /projectNotificationDeliveryReadState\(/);
  assert.match(section, /canRequeue: hasAdminPermission\(data, "notifications\.manage"\)/);
  assert.match(section, /target\.isConnected && isCurrentPageRequest\(lifetime\)/);
  assert.match(section, /freshCurrent !== current/);
  assert.match(section, /canShowAdminFeature\(state\.actorGrants, "notificationDelivery"\)/);
  assert.match(section, /hasAdminPermission\(freshCurrent, "notifications\.manage"\)/);
  assert.match(section, /\["failed", "dead_letter"\]\.includes\(sourceRow\.status\)/);
  assert.match(section, /"\/api\/notifications\/delivery\/" \+ encodeURIComponent\(deliveryId\) \+ "\/requeue"/);
  assert.match(section, /Notification requeue accepted\. Delivery is not confirmed as sent\./);
  assert.match(section, /runAdminProtectedCommand\(/);
  assert.doesNotMatch(routeSource, /mountAdminNotificationDelivery/);
});

test("typed section lazy-loads the feature with accessible loading and failure states", () => {
  assert.match(routeSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "notificationDelivery"\), \(\) => import\("\.\.\/src\/features\/notifications\/delivery-operations\/NotificationDeliveryOperationsSection\.tsx"\)\)/);
  assert.match(sectionSource, /lazy\(\(\) =>\s*import\("\.\/NotificationDeliveryOperations"\)/);
  assert.match(sectionSource, /StateMessage kind="loading" title="Loading notification delivery operations"/);
  assert.match(sectionSource, /The delivery feature could not be downloaded\. Reload Admin to try again\./);
  assert.doesNotMatch(sectionSource, /design-system\/index|design-system\/components/);
  assert.doesNotMatch(routeSource, /from "\.\.\/src\/features\/notifications\/delivery-operations\/(?:index|NotificationDeliveryOperations)"/);
});
