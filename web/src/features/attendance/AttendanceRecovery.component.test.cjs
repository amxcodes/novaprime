const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  attendanceRecoveryStatus,
  beginAttendanceRecoveryRead,
  completeAttendanceRecoveryRead,
  createAttendanceRecoveryState,
  failAttendanceRecoveryRead,
} = require("./recovery-model.ts");
const { AttendanceRecovery } = require("./AttendanceRecovery.tsx");

const firstCandidate = {
  personId: "person-1",
  personName: "Aman Verma",
  businessDate: "2026-10-01",
  recoveryReason: "missing_checkout",
  officeName: "Bengaluru office",
  officeTimezone: "Asia/Kolkata",
  mode: "office",
  checkedInAt: "2026-10-01T04:00:00.000Z",
  checkedOutAt: null,
};

const secondCandidate = {
  ...firstCandidate,
  personId: "person-2",
  personName: "Sam Lee",
  businessDate: "2026-09-30",
  recoveryReason: "missing_attendance",
  mode: null,
  checkedInAt: null,
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(AttendanceRecovery, {
    initialResult: { candidates: [firstCandidate], nextCursor: null },
    loadCandidates: async () => ({ candidates: [] }),
    isCurrentPageRequest: () => true,
    makeReadError: () => null,
    businessTimeLabel: (value, timezone) => `${value} ${timezone}`,
    onCorrect() {},
    ...props,
  }));
}

test("recovery model represents loading and initial read failures", () => {
  assert.deepEqual(createAttendanceRecoveryState(), {
    status: "loading",
    candidates: [],
    nextCursor: null,
    shownCount: 0,
    loadingMore: false,
    pageFailure: null,
  });

  const failure = { kind: "warning", message: "Recovery records are unavailable for this role." };
  const failed = createAttendanceRecoveryState({ readError: "PERMISSION_DENIED" }, failure);
  assert.equal(failed.status, "error");
  assert.equal(failed.pageFailure, failure);
  assert.equal(attendanceRecoveryStatus(failed), "Attendance recovery is unavailable.");
});

test("recovery model appends cursor pages and keeps the cursor retryable after a later-page failure", () => {
  const initial = createAttendanceRecoveryState({ candidates: [firstCandidate], nextCursor: "cursor-1" });
  const loadingMore = beginAttendanceRecoveryRead(initial, true);
  assert.equal(loadingMore.status, "ready");
  assert.equal(loadingMore.loadingMore, true);
  assert.deepEqual(loadingMore.candidates, [firstCandidate]);

  const loaded = completeAttendanceRecoveryRead(loadingMore, {
    candidates: [secondCandidate],
    nextCursor: "cursor-2",
  }, true);
  assert.deepEqual(loaded.candidates, [firstCandidate, secondCandidate]);
  assert.equal(loaded.shownCount, 2);
  assert.equal(loaded.nextCursor, "cursor-2");
  assert.equal(attendanceRecoveryStatus(loaded), "Showing 2 eligible workdays. Older pages are available.");

  const failed = failAttendanceRecoveryRead(
    beginAttendanceRecoveryRead(loaded, true),
    true,
    { kind: "error", message: "The next page failed." },
  );
  assert.deepEqual(failed.candidates, loaded.candidates);
  assert.equal(failed.nextCursor, "cursor-2");
  assert.equal(failed.loadingMore, false);
  assert.equal(failed.pageFailure.message, "The next page failed.");
});

test("a failed first-page retry clears stale candidates and its old cursor", () => {
  const existing = createAttendanceRecoveryState({ candidates: [firstCandidate], nextCursor: "old-cursor" });
  const failed = failAttendanceRecoveryRead(existing, false, { kind: "error", message: "Try again later." });
  assert.deepEqual(failed.candidates, []);
  assert.equal(failed.nextCursor, null);
  assert.equal(failed.shownCount, 0);
  assert.equal(failed.status, "error");
});

test("component exposes recoverable read failures and only offers older-page loading with a cursor", () => {
  const failed = render({
    initialResult: { readError: "REQUEST_FAILED" },
    initialReadError: { kind: "error", message: "Could not load recovery candidates." },
  });
  assert.match(failed, /Attendance recovery unavailable/);
  assert.match(failed, /Could not load recovery candidates\./);
  assert.match(failed, /Try again/);

  const paged = render({ initialResult: { candidates: [firstCandidate], nextCursor: "opaque-cursor" } });
  assert.match(paged, /Load older eligible workdays/);
  assert.match(paged, /Older pages are available\./);
  assert.match(paged, /Aman Verma · 2026-10-01 · check-out missing · Bengaluru office \(Asia\/Kolkata\)/);
  assert.doesNotMatch(render(), /Load older eligible workdays/);
});

test("recovery summary uses shared status badges and keeps its full live-region message", () => {
  const ready = render({ initialResult: { candidates: [firstCandidate, secondCandidate], nextCursor: "older" } });
  assert.match(ready, /role="status" aria-live="polite" aria-atomic="true"[^>]*>/);
  assert.match(ready, /data-tone="warning"><span>2 eligible workdays<\/span><\/span>/);
  assert.match(ready, /data-tone="info"><span>Older pages available<\/span><\/span>/);
  assert.match(ready, /Showing 2 eligible workdays\. Older pages are available\./);

  const empty = render({ initialResult: { candidates: [] } });
  assert.match(empty, /data-tone="success"><span>0 eligible workdays<\/span><\/span>/);

  const failed = render({ initialResult: { readError: "REQUEST_FAILED" } });
  assert.match(failed, /data-tone="danger"><span>Unavailable<\/span><\/span>/);
  assert.match(failed, /Attendance recovery is unavailable\./);
});

test("correction form exposes required, labeled fields and a timestamp pattern that accepts ISO 8601 offsets", () => {
  const html = render({ initialResult: { candidates: [secondCandidate] } });
  const expectedPattern = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})`;

  assert.match(html, /Attendance mode<\/span><span aria-hidden="true">\*<\/span>/);
  assert.match(html, /data-testid="hidden-select-container"[\s\S]*?<select tabindex="-1" required="" name="mode"[\s\S]*?<option value="office" selected="">Office<\/option>[\s\S]*?<option value="wfh">Work from home<\/option>/);
  assert.match(html, /Check-in timestamp/);
  assert.match(html, /Check-out timestamp \(optional\)/);
  assert.match(html, /Correction reason/);
  const checkInInput = html.match(/<input(?=[^>]*name="checkedInAt")[^>]*>/)?.[0];
  assert.ok(checkInInput, "expected check-in input");
  assert.ok(checkInInput.includes('required=""'), "check-in timestamp must be required");
  assert.ok(checkInInput.includes(`pattern="${expectedPattern}"`),
    `expected a single-backslash ISO 8601 pattern, received ${checkInInput}`);
  const timestampPattern = new RegExp(`^(?:${expectedPattern})$`);
  assert.equal(timestampPattern.test("2026-10-01T09:30:00+05:30"), true);
  assert.equal(timestampPattern.test("2026-10-01T04:00:00Z"), true);
  assert.equal(timestampPattern.test("2026-10-01 09:30"), false);

  const checkOutInput = html.match(/<input(?=[^>]*name="checkedOutAt")[^>]*>/)?.[0];
  assert.ok(checkOutInput?.includes(`pattern="${expectedPattern}"`), "optional check-out must use the same timestamp format");
  assert.match(html, /<textarea[^>]*required=""[^>]*name="reason"[^>]*maxLength="2000"/);
});

test("an unknown attendance mode remains editable through the authored finite-choice picker", () => {
  const html = render({ initialResult: { candidates: [secondCandidate] } });
  const trigger = html.match(/<button id="[^"]+-mode"[^>]*>/)?.[0];

  assert.ok(trigger, "expected the attendance mode trigger");
  assert.match(trigger, /aria-haspopup="listbox"/);
  assert.doesNotMatch(trigger, /disabled=""/);
  assert.match(html, /<select tabindex="-1" required="" name="mode">[\s\S]*?<option value="office" selected="">Office<\/option>/);
});

test("candidate disclosures replace the browser marker with a tokenized chevron", () => {
  const html = render();
  const css = fs.readFileSync(`${__dirname}/AttendanceRecovery.module.css`, "utf8");

  assert.match(html, /<details><summary>Aman Verma · 2026-10-01/);
  assert.match(css, /\.summary\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\)[^}]*list-style:\s*none/s);
  assert.match(css, /\.summary::marker\s*\{\s*content:\s*"";\s*\}/);
  assert.match(css, /\.summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.summary::after\s*\{[^}]*border-inline-end:\s*1\.5px solid currentColor[^}]*transition:\s*transform var\(--nova-motion-duration-fast\) var\(--nova-motion-ease-standard\)/s);
  assert.match(css, /\.candidate\[open\] \.summary::after\s*\{[^}]*rotate\(225deg\)/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.summary::after\s*\{\s*border-color:\s*currentColor;/);
  assert.match(css, /\.summary:focus-visible\s*\{\s*outline-offset:\s*-3px;\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.summary::after\s*\{\s*transition:\s*none;/);
});
