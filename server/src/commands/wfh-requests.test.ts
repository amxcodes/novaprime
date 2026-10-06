import { describe, expect, test } from "bun:test";
import { presentWfhRequest, wfhMineReadSql } from "./wfh-request-read-model";

describe("own WFH cancellation hint projection", () => {
  test("the /mine query scopes rows to the actor and shares cancel eligibility with the command", () => {
    const sql = wfhMineReadSql.replace(/\s+/g, " ").toLowerCase();

    expect(sql).toContain("from nova.wfh_requests requests");
    expect(sql).toContain("where requests.organisation_id = $1 and requests.person_id = $2");
    expect(sql).toContain("requests.status in ('pending', 'approved')");
    expect(sql).toContain("requests.end_date >= $3::date");
    expect(sql).toContain("not exists (");
    expect(sql).toContain("from nova.attendance_days attendance");
    expect(sql).toContain("attendance.person_id = requests.person_id");
    expect(sql).toContain("attendance.mode = 'wfh'");
    expect(sql).toContain("attendance.business_date between requests.start_date and requests.end_date");
    expect(sql).toContain("as can_cancel");
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/);
  });

  test("maps only the server's boolean hint into the existing /mine response shape", () => {
    const base = {
      id: "request-1",
      person_id: "person-1",
      start_date: "2026-10-05",
      end_date: "2026-10-05",
      reason: null,
      status: "pending",
      reviewer_person_id: null,
      reviewed_at: null,
      review_reason: null,
    };

    expect(presentWfhRequest({ ...base, can_cancel: true })).toMatchObject({
      id: "request-1",
      startDate: "2026-10-05",
      endDate: "2026-10-05",
      status: "pending",
      canCancel: true,
    });
    expect(presentWfhRequest({ ...base, can_cancel: false })).toMatchObject({ canCancel: false });
    expect(presentWfhRequest(base)).not.toHaveProperty("canCancel");
  });
});
