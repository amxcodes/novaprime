import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttendanceRecovery } from "../../src/features/attendance/AttendanceRecovery.tsx";
import { renderAttendanceRecovery } from "./recovery.js";

const candidate = {
  personId: "person-1",
  personName: "Morgan Lee",
  businessDate: "2026-10-01",
  recoveryReason: "missing_checkout",
  officeName: "Central office",
  officeTimezone: "Asia/Kolkata",
  mode: "office",
  checkedInAt: "2026-10-01T04:00:00.000Z",
  checkedOutAt: null,
};

const baseProps = {
  initialResult: { candidates: [candidate] },
  initialReadError: null,
  loadCandidates: async () => ({ candidates: [] }),
  isCurrentPageRequest: () => true,
  makeReadError: () => null,
  businessTimeLabel: (value) => value,
  onCorrect: () => {},
};

function render(props = {}) {
  return renderToStaticMarkup(createElement(AttendanceRecovery, { ...baseProps, ...props }));
}

describe("AttendanceRecovery", () => {
  test("preserves candidate context and exposes labeled, required correction controls", () => {
    const markup = render();

    expect(markup).toContain("Morgan Lee · 2026-10-01 · check-out missing · Central office (Asia/Kolkata)");
    expect(markup).toMatch(/<span id="[^"]+"><span>Attendance mode<\/span>/);
    expect(markup).toMatch(/<button[^>]*aria-labelledby="[^"]+ [^"]+"[^>]*aria-haspopup="listbox"/);
    expect(markup).toMatch(/<select tabindex="-1"[^>]*required=""[^>]*name="mode"[^>]*>[\s\S]*?<option value="office" selected="">Office/);
    expect(markup).toContain('disabled=""');
    expect(markup).toMatch(/<label[^>]*for="[^"]+"[^>]*>.*?Check-in timestamp/s);
    expect(markup).toContain('name="checkedInAt"');
    expect(markup).toMatch(/readOnly=""/i);
    expect(markup).toContain('name="checkedOutAt"');
    expect(markup).toContain('name="reason"');
    expect(markup).toContain('required=""');
    expect(markup).toContain("ISO 8601 timestamps with Z or an explicit UTC offset");
  });

  test("keeps unknown attendance mode editable and preserves the native picker contract", () => {
    const markup = render({
      initialResult: { candidates: [{ ...candidate, mode: null, recoveryReason: "missing_attendance", checkedInAt: null }] },
    });

    expect(markup).toMatch(/<select tabindex="-1"[^>]*required=""[^>]*name="mode"[^>]*>[\s\S]*?<option value="office" selected="">Office/);
    expect(markup).toMatch(/<button[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
    expect(markup).not.toMatch(/name="checkedInAt"[^>]*readonly=""/);
    expect(markup).toContain('placeholder="2026-10-01T09:30:00+05:30"');
  });

  test("keeps the host read-error wording and distinguishes an unavailable read from an empty queue", () => {
    const markup = render({
      initialResult: { readError: "PERMISSION_DENIED" },
      initialReadError: { kind: "warning", message: "Attendance recovery is not available to this role." },
    });

    expect(markup).toContain("Attendance recovery unavailable");
    expect(markup).toContain("Attendance recovery is not available to this role.");
    expect(markup).not.toContain("No eligible attendance gaps");
  });

  test("retains a clear host adapter contract", async () => {
    await expect(renderAttendanceRecovery({}, {}, null, {})).rejects.toThrow("ATTENDANCE_RECOVERY_HOST_CONTRACT_INVALID");
  });
});
