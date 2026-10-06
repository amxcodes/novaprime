const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

const filename = path.join(__dirname, "admin-attendance-policy-route.js");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const compiled = { exports: {} };
new Function("module", "exports", output)(compiled, compiled.exports);
const { projectAttendancePolicySettingsProps } = compiled.exports;

const currentPolicy = {
  mode: "hour_based",
  requiredAttendanceMinutes: 480,
  effectiveOn: "2026-09-01",
  privatePolicyMetadata: "must not cross the feature boundary",
};

test("Admin policy projector passes only the safe current policy and host action", () => {
  const onSchedule = () => undefined;
  const props = projectAttendancePolicySettingsProps({
    organisationRead: {
      organisation: {
        attendancePolicy: currentPolicy,
        privateBillingData: "omit",
      },
      unrelatedPrivateValue: "omit",
    },
    canManage: true,
    onSchedule,
  });

  assert.deepEqual(props, {
    access: { status: "visible", manage: "allowed" },
    read: { status: "ready", policy: {
      mode: "hour_based",
      requiredAttendanceMinutes: 480,
      effectiveOn: "2026-09-01",
    } },
    onSchedule,
  });
  assert.doesNotMatch(JSON.stringify(props.read), /privatePolicyMetadata|privateBillingData|unrelatedPrivateValue/);
});

test("policy projector keeps denied, unavailable, failed, and malformed reads distinct", () => {
  assert.deepEqual(projectAttendancePolicySettingsProps({
    organisationRead: { organisation: { attendancePolicy: null } },
    canManage: false,
  }).access, { status: "visible", manage: "denied" });
  assert.deepEqual(projectAttendancePolicySettingsProps({
    organisationRead: { readError: "PERMISSION_DENIED" },
    readFailure: { status: "unavailable", message: "Permission required." },
  }).read, { status: "unavailable", message: "Permission required." });
  assert.deepEqual(projectAttendancePolicySettingsProps({
    organisationRead: { readError: "REQUEST_FAILED" },
    readFailure: { status: "error", message: "Organisation read failed." },
  }).read, { status: "error", message: "Organisation read failed." });
  assert.deepEqual(projectAttendancePolicySettingsProps({ organisationRead: {} }).read, {
    status: "error",
    message: "The organisation settings response could not be read. Refresh Admin to try again.",
  });
});

test("Admin composes the typed section under the exact organization manage grant and retains host command guards", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const routeSource = fs.readFileSync(path.join(__dirname, "admin-page-route.js"), "utf8");
  const sectionSource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "admin", "attendance-policy", "AttendancePolicySettingsSection.tsx"), "utf8");
  const capabilitySource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "admin", "capabilities.ts"), "utf8");

  assert.match(capabilitySource, /attendancePolicy:\s*Object\.freeze\(\{\s*permissionKeys:\s*Object\.freeze\(\["organisation\.settings\.manage"\]\),\s*scopes:\s*organisationScopes/);
  assert.match(routeSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "attendancePolicy"\), \(\) => import\("\.\.\/src\/features\/admin\/attendance-policy\/AttendancePolicySettingsSection\.tsx"\)\)/);
  assert.match(routeSource, /"attendance-policy": AttendancePolicySettings\s*\? createElement\(AttendancePolicySettings,/);
  assert.match(routeSource, /canManage: hasAdminPermission\(data, "organisation\.settings\.manage"\)/);
  assert.match(routeSource, /runAdminProtectedCommand\([\s\S]*?"organisation\.settings\.manage", \{\},[\s\S]*?"PATCH", "\/api\/organisation\/attendance-policy", request, "Attendance policy scheduled\."/);
  assert.match(appSource, /adminPageRoute\(data, lifetime\)/);
  assert.doesNotMatch(routeSource, /mountAdminAttendancePolicy/);
  assert.match(sectionSource, /lazy\(\(\) =>\s*import\("\.\/AttendancePolicySettings"\)/);
  assert.match(sectionSource, /StateMessage kind="loading" title="Loading attendance policy settings"/);
  assert.match(sectionSource, /The attendance policy feature could not be downloaded\. Reload Admin to try again\./);
  assert.doesNotMatch(sectionSource, /design-system\/index|design-system\/components/);
});
