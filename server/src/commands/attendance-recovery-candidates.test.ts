import { describe, expect, test } from "bun:test";
import {
  attendanceRecoveryCandidatesReadSql,
  parseAttendanceRecoveryCandidateFilters,
} from "./attendance-recovery.js";

const personId = "11111111-1111-4111-8111-111111111111";

describe("attendance recovery candidate read contract", () => {
  test("bounds keyset pages and validates the office business-date/person cursor", () => {
    expect(parseAttendanceRecoveryCandidateFilters(new Request("https://nova.test/api/attendance/recovery-candidates"))).toEqual({
      limit: 50,
      cursorBusinessDate: null,
      cursorPersonId: null,
    });
    expect(parseAttendanceRecoveryCandidateFilters(new Request(
      `https://nova.test/api/attendance/recovery-candidates?limit=100&cursor=2026-09-30~${personId}`,
    ))).toEqual({ limit: 100, cursorBusinessDate: "2026-09-30", cursorPersonId: personId });
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=1&limit=2",
      "cursor=2026-02-30~" + personId,
      "cursor=2026-09-30~not-a-uuid",
      "cursor=2026-09-30~" + personId + "~extra",
      "cursor=2026-09-30~" + personId + "&cursor=2026-09-29~" + personId,
    ]) {
      expect(parseAttendanceRecoveryCandidateFilters(new Request(
        `https://nova.test/api/attendance/recovery-candidates?${query}`,
      ))).toBeUndefined();
    }
  });

  test("applies target-date recover scope and business eligibility before cursor paging", () => {
    const sql = attendanceRecoveryCandidatesReadSql.toUpperCase();
    const targetPermission = sql.indexOf("GRANTS.PERMISSION_KEY = 'ATTENDANCE.RECOVER'");
    const targetDateScope = sql.indexOf("ACTOR_ROLES.EFFECTIVE_ON <= DAY.BUSINESS_DATE::DATE");
    const cursor = sql.indexOf("(BUSINESS_DATE, PERSON_ID) < ($3::DATE, $4::UUID)");
    const limit = sql.indexOf("LIMIT $5");
    expect(targetPermission).toBeGreaterThan(-1);
    expect(targetDateScope).toBeGreaterThan(-1);
    expect(targetPermission).toBeLessThan(cursor);
    expect(targetDateScope).toBeLessThan(cursor);
    expect(cursor).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(cursor);
    expect(sql).toContain("GRANTS.SCOPE = 'ORGANISATION'");
    expect(sql).toContain("GRANTS.SCOPE = 'OWN_RECORD' AND PEOPLE.ID = $2");
    expect(sql).toContain("GRANTS.SCOPE = 'OFFICE' AND OFFICE_ASSIGNMENTS.OFFICE_ID = GRANTS.OFFICE_ID");
    expect(sql).toContain("GRANTS.SCOPE = 'ORGANISATION_DEPARTMENT'");
    expect(sql).toContain("NOVA.PERSON_BUSINESS_DATE(PEOPLE.ID)");
    expect(sql).toContain("REQUEST_CLOCK.AT AT TIME ZONE OFFICES.TIMEZONE");
    expect(sql).toContain("POLICIES.ATTENDANCE_REQUIRED");
    expect(sql).toContain("SELECT 1 FROM NOVA.OFFICE_HOLIDAYS");
    expect(sql).toContain("LEAVE_REQUESTS.STATUS = 'APPROVED' AND LEAVE_DAYS.PORTION = 1.0");
    expect(sql).toContain("PROVISIONAL.STATUS = 'PENDING'");
    expect(sql).toContain("FROM NOVA.ATTENDANCE_CORRECTIONS CORRECTIONS");
    expect(sql).toContain("ATTENDANCE.CHECKED_OUT_AT IS NULL");
    expect(sql).toContain("ORDER BY BUSINESS_DATE DESC, PERSON_ID DESC");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});
