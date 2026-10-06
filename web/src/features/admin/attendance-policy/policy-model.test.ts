import { describe, expect, it } from "bun:test";
import {
  attendancePolicyDraft,
  attendancePolicyReadChanged,
  attendancePolicyReadKey,
  buildAttendancePolicyRequest,
  selectAttendancePolicyMode,
} from "./policy-model";

describe("attendance policy request contract", () => {
  it("starts with an explicit date instead of assuming the browser's business date", () => {
    expect(attendancePolicyDraft(null)).toEqual({
      mode: "hour_based",
      effectiveOn: "",
      requiredAttendanceMinutes: "480",
    });
  });

  it("keeps the current mode and duration while leaving the effective date blank", () => {
    expect(attendancePolicyDraft({ mode: "scheduled", requiredAttendanceMinutes: 525, effectiveOn: "2026-09-01" }))
      .toEqual({ mode: "scheduled", effectiveOn: "", requiredAttendanceMinutes: "525" });
  });

  it("uses a stable content key and detects when an authoritative read changes", () => {
    const original = { mode: "hour_based" as const, requiredAttendanceMinutes: 480, effectiveOn: "2026-09-01" };
    const sameValues = { ...original };
    const updated = { ...original, mode: "scheduled" as const };
    const originalKey = attendancePolicyReadKey(original);

    expect(attendancePolicyReadKey(sameValues)).toBe(originalKey);
    expect(attendancePolicyReadChanged(originalKey, attendancePolicyReadKey(sameValues))).toBe(false);
    expect(attendancePolicyReadChanged(originalKey, attendancePolicyReadKey(updated))).toBe(true);
    expect(attendancePolicyReadChanged(null, attendancePolicyReadKey(null))).toBe(true);
    expect(attendancePolicyReadChanged(originalKey, null)).toBe(false);
  });

  it("repairs an invalid hidden duration when switching to scheduled mode", () => {
    const draft = {
      mode: "hour_based" as const,
      effectiveOn: "2026-10-03",
      requiredAttendanceMinutes: "0",
    };

    expect(selectAttendancePolicyMode(draft, "scheduled", 525)).toEqual({
      ...draft,
      mode: "scheduled",
      requiredAttendanceMinutes: "525",
    });
    expect(selectAttendancePolicyMode(draft, "scheduled", 0).requiredAttendanceMinutes).toBe("480");
    expect(selectAttendancePolicyMode({ ...draft, requiredAttendanceMinutes: "600" }, "scheduled", 525).requiredAttendanceMinutes).toBe("600");
  });

  it("accepts the API mode values, whole-minute boundaries, and a real calendar date", () => {
    for (const mode of ["hour_based", "scheduled"] as const) {
      for (const requiredAttendanceMinutes of [1, 1440]) {
        const result = buildAttendancePolicyRequest({
          mode,
          effectiveOn: "2028-02-29",
          requiredAttendanceMinutes: String(requiredAttendanceMinutes),
        });
        expect(result.request).toEqual({ mode, effectiveOn: "2028-02-29", requiredAttendanceMinutes });
        expect(result.errors).toEqual({});
      }
    }
  });

  it("rejects blank or impossible dates, including non-leap February 29", () => {
    for (const effectiveOn of ["", "2028-2-09", "2026-02-29", "2026-04-31", "2026/04/30"]) {
      const result = buildAttendancePolicyRequest({
        mode: "hour_based",
        effectiveOn,
        requiredAttendanceMinutes: "480",
      });
      expect(result.request).toBeUndefined();
      expect(result.errors.effectiveOn).toBe("Choose a valid effective date.");
    }
  });

  it("rejects unsupported modes and values the server cannot accept", () => {
    for (const requiredAttendanceMinutes of ["", "0", "1441", "1.5", "1e2", "-1", "99999"]) {
      const result = buildAttendancePolicyRequest({
        mode: "hour_based",
        effectiveOn: "2026-10-03",
        requiredAttendanceMinutes,
      });
      expect(result.request).toBeUndefined();
      expect(result.errors.requiredAttendanceMinutes).toContain("1 to 1,440");
    }

    const badMode = buildAttendancePolicyRequest({
      mode: "invalid" as "hour_based",
      effectiveOn: "2026-10-03",
      requiredAttendanceMinutes: "480",
    });
    expect(badMode.request).toBeUndefined();
    expect(badMode.errors.mode).toContain("Choose");
  });
});
