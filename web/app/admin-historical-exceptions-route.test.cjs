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

const webRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
const routeSource = fs.readFileSync(path.join(webRoot, "app", "admin-page-route.js"), "utf8");
const sectionsSource = fs.readFileSync(path.join(webRoot, "src", "pages", "admin", "admin-page-sections.ts"), "utf8");
const capabilitiesSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "capabilities.ts"), "utf8");
const sectionSource = fs.readFileSync(path.join(webRoot, "src", "features", "admin", "exceptions", "HistoricalExceptionsSection.tsx"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "server", "src", "commands", "historical-exceptions.ts"), "utf8");
const { projectHistoricalExceptionsReadState } = require("../src/features/admin/exceptions/projection.ts");

test("historical-exception projector passes a minimal row and strips raw details", () => {
  const read = projectHistoricalExceptionsReadState({ exceptions: [{
    id: "exception-1",
    code: "attendance.clock_adjustment",
    businessDate: "2026-10-01",
    status: "open",
    sourceType: "attendance_record",
    sourceId: "attendance-42",
    resolutionNote: null,
    details: { email: "private@example.test", medicalReason: "private detail" },
    personId: "private-person-id",
    openedAt: "private-timestamp",
    linkedLeaveRequestId: "private-unprojected-link",
  }] });

  assert.deepEqual(read, {
    status: "ready",
    exceptions: [{
      id: "exception-1",
      code: "attendance.clock_adjustment",
      businessDate: "2026-10-01",
      status: "open",
      sourceType: "attendance_record",
      sourceId: "attendance-42",
      resolutionNote: null,
    }],
  });
  assert.doesNotMatch(JSON.stringify(read), /private@example|medicalReason|private-person|private-timestamp|private-unprojected-link/);
});

test("historical-exception projector distinguishes denied, failed, empty, and malformed reads", () => {
  assert.deepEqual(projectHistoricalExceptionsReadState(null, {
    status: "unavailable", message: "No access to this organisation list.",
  }), { status: "denied", message: "No access to this organisation list." });
  assert.deepEqual(projectHistoricalExceptionsReadState(null, {
    status: "error", message: "Refresh the authorised exception read.",
  }), { status: "error", message: "Refresh the authorised exception read." });
  assert.deepEqual(projectHistoricalExceptionsReadState({ exceptions: [] }), { status: "empty" });

  for (const malformed of [null, [], {}, { exceptions: "not-an-array" }, { exceptions: [null] }, {
    exceptions: [{ id: "exception-2", status: "unknown" }],
  }]) {
    assert.equal(projectHistoricalExceptionsReadState(malformed).status, "error");
  }
});

test("Admin composes the lazy typed feature under org view grant and keeps resolution independent", () => {
  assert.match(sectionsSource, /\["historical-exceptions", canShowAdminFeature\(read, "historicalExceptions"\)\]/);
  assert.match(capabilitiesSource, /historicalExceptions:\s*Object\.freeze\(\{[\s\S]*?permissionKeys: Object\.freeze\(\["availability\.exception\.view"\]\),[\s\S]*?scopes: organisationScopes/);
  assert.match(routeSource, /historicalExceptionsModule: \(\) => import\("\.\.\/src\/features\/admin\/exceptions\/HistoricalExceptionsSection\.tsx"\)/);
  assert.match(routeSource, /load\("historicalExceptionsModule", canShowAdminFeature\(data\.actorGrants, "historicalExceptions"\)\)/);
  assert.match(routeSource, /"historical-exceptions": HistoricalExceptions \? createElement\(HistoricalExceptions, \{/);
  assert.match(routeSource, /view: true,[\s\S]{0,120}resolve: hasAdminPermission\(data, "availability\.exception\.resolve"\)/);
  assert.match(routeSource, /projectHistoricalExceptionsReadState\(\s*data\.exceptions,\s*adminFeatureReadError\(data\.exceptions, "historical exceptions"\),\s*\)/);
  assert.doesNotMatch(routeSource, /mountAdminHistoricalExceptions/);
  assert.doesNotMatch(routeSource, /"historical-exceptions"[\s\S]{0,1400}onOpenLinkedLeaveRequest/);
});

test("resolve host callback preserves row eligibility, fresh grant, exact POST contract, and request guards", () => {
  const start = routeSource.indexOf('"historical-exceptions": HistoricalExceptions ? createElement(HistoricalExceptions');
  const end = routeSource.indexOf(': featureLoadFailure("Historical exceptions")', start);
  assert.ok(start >= 0 && end > start);
  const section = routeSource.slice(start, end);

  assert.match(section, /data\.exceptions\?\.exceptions\?\.find\(\(item\) => item\.id === exceptionId\)/);
  assert.match(section, /exception\.status !== "open"/);
  assert.match(section, /exception\.code === "availability\.leave_attendance_conflict"/);
  assert.match(section, /hasAdminPermission\(state\.adminData, "availability\.exception\.resolve"\)/);
  assert.match(section, /runAdminRequestReviewCommand\(\s*target, lifetime, data,\s*"\/api\/historical-exceptions\/" \+ encodeURIComponent\(exceptionId\) \+ "\/resolve",\s*\{ status: outcome, note: auditNote \}/);

  assert.match(appSource, /async function runAdminRequestReviewCommand\(target, lifetime, data, path, payload, successMessage\)[\s\S]{0,350}!target\.isConnected \|\| !isCurrentPageRequest\(lifetime\) \|\| state\.adminData !== data/);
  assert.match(appSource, /await api\(path, requestOptions\("POST", payload\)\)/);
  assert.match(appSource, /if \(!isCurrentCommandIdentity\(context\)\)/);
  assert.match(appSource, /recoverProtectedCommandFailure\(error, context, accessChangedMessage\)/);
});

test("the feature wrapper lazy-loads accessible states and server command reauthorizes audited open-row resolution", () => {
  assert.match(sectionSource, /lazy\(\(\) =>\s*import\("\.\/HistoricalExceptions"\)/);
  assert.match(sectionSource, /StateMessage kind="loading" title="Loading historical exceptions"/);
  assert.match(sectionSource, /Historical exception controls could not be downloaded\. Reload Admin to try again\./);
  assert.doesNotMatch(sectionSource, /design-system\/index|design-system\/components/);

  assert.match(serverSource, /hasOrganisationPermission\(transaction, actor\.context\.userId, "availability\.exception\.view"\)/);
  assert.match(serverSource, /hasOrganisationPermission\(transaction, actor\.context\.userId, "availability\.exception\.resolve"\)/);
  assert.match(serverSource, /note\.length > 2000/);
  assert.match(serverSource, /status !== "resolved" && status !== "dismissed"/);
  assert.match(serverSource, /code === "availability\.leave_attendance_conflict"/);
  assert.match(serverSource, /status = 'open'/);
});
