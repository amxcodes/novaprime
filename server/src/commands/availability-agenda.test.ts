import { describe, expect, mock, test } from "bun:test";

// These tests cover the pure cursor/query contract and do not open a database.
// Keep the command module import hermetic when the local Bun install cannot
// resolve its package-linked PostgreSQL driver.
mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));

const {
  availabilityAgendaAccessOutcome,
  availabilityAgendaReadSql,
  hasUnversionedAvailabilityCursor,
  parseAvailabilityAgendaFilters,
} = await import("./availability-agenda.js");

const base = "https://nova.test/api/availability/agenda?startDate=2026-10-01&endDate=2026-10-31";
const officeId = "11111111-1111-4111-8111-111111111111";
const calendarId = "22222222-2222-4222-8222-222222222222";
const ruleId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";

describe("availability agenda read contract", () => {
  test("requires an ISO date window of at most 31 days and bounds page size", () => {
    expect(parseAvailabilityAgendaFilters(new Request(base))).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      limit: 50,
      cursorDate: null,
      cursorKind: null,
      cursorKey: null,
      cursorAccessRevision: null,
    });
    expect(parseAvailabilityAgendaFilters(new Request(`${base}&limit=100`))?.limit).toBe(100);

    for (const query of [
      "startDate=2026-10-01",
      "startDate=2026-10-01&endDate=2026-10-31&startDate=2026-10-02",
      "startDate=2026-02-30&endDate=2026-03-01",
      "startDate=2026-10-31&endDate=2026-10-01",
      "startDate=2026-10-01&endDate=2026-11-01",
      "startDate=2026-10-01&endDate=2026-10-31&limit=0",
      "startDate=2026-10-01&endDate=2026-10-31&limit=101",
      "startDate=2026-10-01&endDate=2026-10-31&limit=20&limit=30",
    ]) {
      expect(parseAvailabilityAgendaFilters(new Request(
        `https://nova.test/api/availability/agenda?${query}`,
      ))).toBeUndefined();
    }
  });

  test("validates cursors against the date window, event kind, event key, and access revision", () => {
    const shiftKey = `${officeId}:${calendarId}:${ruleId}`;
    const accessRevision = "abcdef0123456789abcdef0123456789";
    expect(parseAvailabilityAgendaFilters(new Request(
      `${base}&cursor=2026-10-01~2026-10-31~2026-10-12~shift~${shiftKey}~${accessRevision}`,
    ))).toMatchObject({
      cursorDate: "2026-10-12", cursorKind: "shift", cursorKey: shiftKey,
      cursorAccessRevision: accessRevision,
    });
    expect(parseAvailabilityAgendaFilters(new Request(
      `${base}&cursor=2026-10-01~2026-10-31~2026-10-12~holiday~${eventId}~${accessRevision}`,
    ))).toMatchObject({ cursorKey: eventId, cursorAccessRevision: accessRevision });
    const legacyCursor = parseAvailabilityAgendaFilters(new Request(
      `${base}&cursor=2026-10-01~2026-10-31~2026-10-12~holiday~${eventId}`,
    ));
    expect(legacyCursor?.cursorAccessRevision).toBeNull();
    expect(legacyCursor && hasUnversionedAvailabilityCursor(legacyCursor)).toBe(true);
    expect(hasUnversionedAvailabilityCursor(parseAvailabilityAgendaFilters(new Request(base))!)).toBe(false);

    for (const cursor of [
      `2026-09-01~2026-10-31~2026-10-12~holiday~${eventId}`,
      `2026-10-01~2026-10-31~2026-11-01~holiday~${eventId}`,
      `2026-10-01~2026-10-31~2026-10-12~unknown~${eventId}`,
      `2026-10-01~2026-10-31~2026-10-12~shift~${eventId}`,
      `2026-10-01~2026-10-31~2026-10-12~holiday~invalid`,
      `2026-10-01~2026-10-31~2026-10-12~holiday~${eventId}~not-a-revision`,
      `2026-10-01~2026-10-31~2026-10-12~holiday~${eventId}~${accessRevision}~extra`,
    ]) {
      expect(parseAvailabilityAgendaFilters(new Request(`${base}&cursor=${cursor}`))).toBeUndefined();
    }
    expect(parseAvailabilityAgendaFilters(new Request(`${base}&cursor=${eventId}&cursor=${eventId}`))).toBeUndefined();
  });

  test("keeps current pages, rejects changed authorization, and fails closed without the revision row", () => {
    const revision = "abcdef0123456789abcdef0123456789";
    expect(availabilityAgendaAccessOutcome(null, revision, true)).toBe("allowed");
    expect(availabilityAgendaAccessOutcome(revision, revision, true)).toBe("allowed");
    expect(availabilityAgendaAccessOutcome(revision, "0123456789abcdef0123456789abcdef", true)).toBe("access_changed");
    expect(availabilityAgendaAccessOutcome(revision, "0123456789abcdef0123456789abcdef", false)).toBe("access_changed");
    expect(availabilityAgendaAccessOutcome(revision, revision, false)).toBe("permission_denied");
    expect(availabilityAgendaAccessOutcome(null, null, false)).toBe("revision_unavailable");
  });

  test("bounds generated schedules and filters every event source by its own active scope before pagination", () => {
    const sql = availabilityAgendaReadSql.toUpperCase();
    const union = sql.lastIndexOf("UNION ALL");
    const cursor = sql.lastIndexOf("WHERE ($5::DATE IS NULL");
    const limit = sql.lastIndexOf("LIMIT $9");
    expect(sql).toContain("GENERATE_SERIES(BOUNDS.START_DATE, BOUNDS.END_DATE, INTERVAL '1 DAY')");
    expect(sql).toContain("CALENDAR_ASSIGNMENTS.EFFECTIVE_ON <= DAYS.BUSINESS_DATE::DATE");
    expect(sql).toContain("CALENDAR_ASSIGNMENTS.EFFECTIVE_UNTIL >= DAYS.BUSINESS_DATE::DATE");
    expect(sql).toContain("EXISTS (SELECT 1 FROM ACTOR_GRANTS WHERE PERMISSION_KEY = 'AVAILABILITY.CALENDAR.VIEW' AND SCOPE = 'ORGANISATION')");
    expect(sql).toContain("EXISTS (SELECT 1 FROM ACTOR_GRANTS WHERE PERMISSION_KEY = 'AVAILABILITY.SHIFT.VIEW' AND SCOPE = 'ORGANISATION')");
    expect(sql).toContain("PERMISSION_KEY = 'AVAILABILITY.HOLIDAY.VIEW' AND SCOPE = 'ORGANISATION'");
    expect(sql).toContain("GRANTS.PERMISSION_KEY = 'ATTENDANCE.VIEW'");
    expect(sql).toContain("GRANTS.SCOPE = 'OFFICE' AND ATTENDANCE.OFFICE_ID = GRANTS.OFFICE_ID");
    expect(sql).toContain("GRANTS.PERMISSION_KEY = 'LEAVE.REVIEW'");
    expect(sql).toContain("GRANTS.PERMISSION_KEY = 'LEAVE.REQUEST' AND PEOPLE.ID = $2");
    expect(sql).toContain("GRANTS.PERMISSION_KEY = 'AVAILABILITY.WFH.REVIEW'");
    expect(sql).toContain("GRANTS.PERMISSION_KEY = 'AVAILABILITY.WFH.REQUEST' AND PEOPLE.ID = $2");
    expect(sql).toContain("REQUESTS.STATUS IN ('REQUESTED', 'PENDING', 'APPROVED')");
    expect(sql).toContain("REQUESTS.STATUS IN ('PENDING', 'APPROVED')");
    expect(sql.indexOf("GRANTS.PERMISSION_KEY = 'ATTENDANCE.VIEW'")).toBeLessThan(cursor);
    expect(sql.indexOf("GRANTS.PERMISSION_KEY = 'LEAVE.REVIEW'")).toBeLessThan(cursor);
    expect(sql.indexOf("GRANTS.PERMISSION_KEY = 'AVAILABILITY.WFH.REVIEW'")).toBeLessThan(cursor);
    expect(cursor).toBeGreaterThan(union);
    expect(limit).toBeGreaterThan(cursor);
    expect(sql).toContain("ACCESS_STATE AS MATERIALIZED");
    expect(sql).toContain("NOVA.ORGANISATION_ACCESS_REVISIONS REVISIONS");
    expect(sql).toContain("'ORGANISATIONREVISION', REVISIONS.REVISION");
    expect(sql).toContain("'EFFECTIVEAGENDAGRANTS'");
    expect(sql).toContain("MD5(JSONB_BUILD_OBJECT(");
    expect(sql).toContain("JSONB_AGG(");
    expect(sql).toContain("ROLE_ID, ASSIGNMENT_ID, ASSIGNMENT_EFFECTIVE_ON, ASSIGNMENT_EFFECTIVE_UNTIL");
    expect(sql).toContain("PERMISSION_KEY, SCOPE::TEXT, OFFICE_ID, ORGANISATION_DEPARTMENT_ID");
    expect(sql).toContain("$8::TEXT = ACCESS_STATE.ACCESS_REVISION");
    expect(sql).toContain("LEFT JOIN AGENDA_PAGE ON TRUE");
  });

  test("excludes provisional evidence and sensitive detail outside the agenda contract", () => {
    const sql = availabilityAgendaReadSql.toUpperCase();
    expect(sql).toContain("FROM NOVA.ATTENDANCE_DAYS ATTENDANCE");
    expect(sql).not.toContain("WFH_PROVISIONAL_ATTENDANCE");
    expect(sql).not.toContain("CHECK_IN_LATITUDE");
    expect(sql).not.toContain("CHECK_IN_LONGITUDE");
    expect(sql).not.toContain("REQUESTS.REASON");
    expect(sql).not.toContain("REQUESTS.REVIEW_REASON");
    expect(sql).toContain("COALESCE(ATTENDANCE.OFFICE_TIMEZONE_SNAPSHOT, OFFICES.TIMEZONE)");
    expect(sql).toContain("SHIFTS.SPANS_MIDNIGHT");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});
