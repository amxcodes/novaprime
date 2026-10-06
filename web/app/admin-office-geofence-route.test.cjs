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
const sectionSource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "admin", "OfficeGeofenceSettingsSection.tsx"), "utf8");
const { projectOfficeGeofenceSettingsProps } = require("../src/features/admin/office-geofence-projection.ts");

test("geofence projector passes only the purpose-limited office fields", () => {
  const onSave = () => undefined;
  const props = projectOfficeGeofenceSettingsProps({
    result: { offices: [
      {
        id: "office-1",
        name: "Central office",
        latitude: 12.9716,
        longitude: 77.5946,
        geofenceRadiusMeters: 150,
        organisationId: "private-organisation",
        archivedAt: "private-archive-time",
        payrollCode: "private-payroll-code",
      },
      { id: "office-2", name: "Missing location", latitude: null, longitude: null, geofenceRadiusMeters: 75 },
      { id: "office-3", name: "Malformed coordinate", latitude: "12.3", longitude: Infinity, geofenceRadiusMeters: 0 },
      { name: "Missing identifier" },
      null,
    ] },
    canManage: true,
    onSave,
  });

  assert.deepEqual(props, {
    canManage: true,
    read: {
      status: "ready",
      offices: [
        { id: "office-1", name: "Central office", latitude: 12.9716, longitude: 77.5946, geofenceRadiusMeters: 150 },
        { id: "office-2", name: "Missing location", latitude: null, longitude: null, geofenceRadiusMeters: 75 },
        { id: "office-3", name: "Malformed coordinate", latitude: null, longitude: null, geofenceRadiusMeters: 0 },
      ],
    },
    onSave,
  });
  assert.doesNotMatch(JSON.stringify(props.read), /private-organisation|private-archive-time|private-payroll-code/);
});

test("geofence projector keeps the current error and empty states distinct", () => {
  assert.deepEqual(projectOfficeGeofenceSettingsProps({
    result: { offices: [{ id: "office-1", name: "Hidden on error" }] },
    issue: { message: "The authorized office settings could not load." },
    canManage: true,
    onSave() {},
  }).read, {
    status: "error",
    offices: [],
    message: "The authorized office settings could not load.",
  });
  assert.deepEqual(projectOfficeGeofenceSettingsProps({
    result: { offices: "malformed" },
    canManage: true,
    onSave() {},
  }).read, { status: "ready", offices: [] });
  assert.equal(projectOfficeGeofenceSettingsProps({
    result: { offices: [] }, canManage: false, onSave() {},
  }).canManage, false);
});

test("Admin wires the typed child through the existing capability and protected command", () => {
  const sectionStart = routeSource.indexOf("geofence: OfficeGeofenceSettings");
  const sectionEnd = routeSource.indexOf(': featureLoadFailure("Office geofencing")', sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const section = routeSource.slice(sectionStart, sectionEnd);

  assert.match(routeSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "geofence"\), \(\) => import\("\.\.\/src\/features\/admin\/OfficeGeofenceSettingsSection\.tsx"\)\)/);
  assert.match(routeSource, /projectOfficeGeofenceSettingsProps/);
  assert.match(section, /issue: adminReadIssue\(data\.geofenceOptions, "office geofence settings"\)/);
  assert.match(section, /canManage: canShowAdminFeature\(data\.actorGrants, "geofence"\)/);
  assert.match(section, /if \(!canShowAdminFeature\(state\.adminData\?\.actorGrants, "geofence"\)\)/);
  assert.match(section, /runAdminProtectedCommand\(/);
  assert.match(section, /"availability\.office_geofence\.manage"/);
  assert.match(section, /"PATCH"/);
  assert.match(section, /"\/api\/offices\/" \+ encodeURIComponent\(officeId\) \+ "\/geofence"/);
  assert.match(section, /input,/);
  assert.match(section, /"Office geofence updated\."/);
  assert.doesNotMatch(routeSource, /renderGeofenceSection|renderOfficeGeofenceSettings|officeGeofenceSettingsRoot/);
});

test("geofence child keeps the section heading and defers the feature with accessible states", () => {
  assert.match(routeSource, /loadAdminFeatureModule\(canShowAdminFeature\(data\.actorGrants, "geofence"\), \(\) => import\("\.\.\/src\/features\/admin\/OfficeGeofenceSettingsSection\.tsx"\)\)/);
  assert.match(sectionSource, /lazy\(\(\) =>\s*import\("\.\/OfficeGeofenceSettings"\)/);
  assert.match(sectionSource, /<h2 className=\{styles\.title\}>Attendance geofences<\/h2>/);
  assert.match(sectionSource, /Set the office coordinates and radius used to validate office check-ins\./);
  assert.match(sectionSource, /StateMessage kind="loading" title="Loading attendance geofences"/);
  assert.match(sectionSource, /Geofence controls could not be downloaded\. Reload Admin to try again\./);
  assert.doesNotMatch(sectionSource, /design-system\/index|design-system\/components/);
});

test("save callback guards against form state updates after the host refresh unmounts the feature", () => {
  const componentSource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "admin", "OfficeGeofenceSettings.tsx"), "utf8");
  assert.match(componentSource, /const mountedRef = useRef\(false\)/);
  assert.match(componentSource, /mountedRef\.current = true;\s*return \(\) => \{\s*mountedRef\.current = false;/);
  assert.match(componentSource, /await onSave\(office\.id, result\.input\);\s*if \(!mountedRef\.current\) return;/);
  assert.match(componentSource, /catch \(saveError\) \{\s*if \(!mountedRef\.current\) return;/);
  assert.match(componentSource, /finally \{\s*if \(mountedRef\.current\) setSaving\(false\);/);
});
