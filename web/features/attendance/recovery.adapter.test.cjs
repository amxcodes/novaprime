const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "recovery.js"), "utf8");

test("loads the React recovery feature only after validating the host and current page lifetime", () => {
  const featureImport = source.indexOf('await import("../../src/features/attendance/AttendanceRecovery.tsx")');
  const contractCheck = source.indexOf("ATTENDANCE_RECOVERY_HOST_CONTRACT_INVALID");
  const firstLifetimeGuard = source.indexOf("if (!isCurrentPageRequest(lifetime)) return;");
  const failureLifetimeGuard = source.indexOf("if (!isCurrentPageRequest(lifetime)) return;", featureImport);
  const successLifetimeGuard = source.indexOf("if (!isCurrentPageRequest(lifetime)) return;", failureLifetimeGuard + 1);
  const mount = source.indexOf("mountReactIsland(target, AttendanceRecovery");

  assert.ok(featureImport > contractCheck, "host contract is checked before downloading the feature");
  assert.ok(firstLifetimeGuard > contractCheck && firstLifetimeGuard < featureImport);
  assert.ok(failureLifetimeGuard > featureImport && failureLifetimeGuard < successLifetimeGuard);
  assert.ok(successLifetimeGuard > featureImport && successLifetimeGuard < mount);
  assert.doesNotMatch(source, /^import\s+\{\s*AttendanceRecovery\s*\}\s+from/m);
});

test("keeps a failed lazy feature local to the current recovery slot", () => {
  assert.match(source, /try\s*\{[\s\S]*?await import\("\.\.\/\.\.\/src\/features\/attendance\/AttendanceRecovery\.tsx"\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?if \(!isCurrentPageRequest\(lifetime\)\) return;[\s\S]*?target\.replaceChildren\(notice\);[\s\S]*?return;/);
  assert.match(source, /notice\.setAttribute\("role", "alert"\)/);
  assert.match(source, /Attendance recovery could not load\. Refresh Operations to try again\./);
});

test("passes the existing read, lifetime, labeling, and command contracts to the lazy feature", () => {
  assert.match(source, /initialReadError,/);
  assert.match(source, /loadCandidates:\s*\(cursor\)\s*=>\s*loadCandidates\(cursor, lifetime\)/);
  assert.match(source, /isCurrentPageRequest:\s*\(\)\s*=>\s*isCurrentPageRequest\(lifetime\)/);
  assert.match(source, /businessTimeLabel,/);
  assert.match(source, /onCorrect,/);
});
