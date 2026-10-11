import { expect, mock, test } from "bun:test";

const actorId = "00000000-0000-4000-8000-000000000001";
const organisationId = "00000000-0000-4000-8000-000000000002";
const targetPersonId = "00000000-0000-4000-8000-000000000003";
const queries: Array<{ sql: string; values: unknown[] }> = [];
let timelineAccessAllowed = true;
let timelineData: Record<string, unknown> = {
  attendance: null,
  attendance_policy: null,
  sessions: [],
  adjustments: [],
};
let adjustmentAllowed = true;

mock.module("../auth-configuration.js", () => ({ authenticationConfiguration: () => ({}) }));
mock.module("../request-actor.js", () => ({
  requestActor: async () => ({ context: { userId: actorId, organisationId } }),
  isNormalOperationalActor: () => true,
}));
mock.module("../db.js", () => ({
  withDatabaseRequest: async (_context: unknown, operation: (transaction: unknown) => unknown) =>
    operation({
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.includes("resolved_date")) {
          return { rows: [{
            allowed: timelineAccessAllowed,
            resolved_date: "2026-10-11",
            adjustment_allowed: adjustmentAllowed,
          }] };
        }
        if (sql.includes("AS attendance_policy")) return { rows: [timelineData] };
        throw new Error("Unexpected timeline query");
      },
    }),
}));
mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));

const { readTimeline } = await import("./timeline.js");

function reset() {
  queries.length = 0;
  timelineAccessAllowed = true;
  adjustmentAllowed = true;
  timelineData = { attendance: null, attendance_policy: null, sessions: [], adjustments: [] };
}

test("timeline page read uses two database round trips while preserving scoped authorization", async () => {
  reset();
  const response = await readTimeline(new Request("https://nova.test/api/work/timeline", { method: "GET" }));
  const result = await response.json() as Record<string, any>;

  expect(response.status).toBe(200);
  expect(result).toMatchObject({
    date: "2026-10-11",
    personId: actorId,
    attendance: null,
    attendanceSummary: { durationMinutes: 0, requiredMinutes: 480, requirementSatisfied: false },
    attendancePolicy: null,
    sessions: [],
    adjustments: [],
    exceptions: [],
    events: [],
  });
  expect(response.headers.get("server-timing")).toMatch(/nova-timeline-access;dur=[\d.]+/);
  expect(response.headers.get("server-timing")).toMatch(/nova-timeline-data;dur=[\d.]+/);
  expect(response.headers.get("server-timing")).not.toContain("nova-timeline-adjustment");
  expect(queries).toHaveLength(2);
  expect(queries[0].sql).toContain("grants.permission_key = 'work.timeline.view'");
  expect(queries[0].sql).toContain("grants.permission_key = 'work.timeline_adjust_own'");
  expect(queries[0].sql).toContain("grants.permission_key = 'work.timeline_adjust_others'");
  for (const scope of ["organisation", "own_record", "office", "organisation_department", "client", "client_workstream", "group", "assigned_work"]) {
    expect(queries[0].sql).toContain(`grants.scope = '${scope}'`);
  }
  expect(queries[1].sql).toContain("attendance_rows AS");
  expect(queries[1].sql).toContain("session_rows AS");
  expect(queries[1].sql).toContain("adjustment_rows AS");
  expect(queries[1].values).toEqual([organisationId, actorId, "2026-10-11"]);
});

test("timeline correction affordances stay hidden when the merged scoped grant check denies them", async () => {
  reset();
  adjustmentAllowed = false;
  const now = new Date();
  timelineData = {
    attendance: {
      id: "attendance-1",
      business_date: "2026-10-11",
      mode: "office",
      checked_in_at: new Date(now.getTime() - 60_000).toISOString(),
      checked_out_at: null,
      closure_reason: null,
      boundary_at: new Date(now.getTime() + 60_000).toISOString(),
    },
    attendance_policy: {
      mode: "hour_based",
      required_attendance_minutes: 480,
      timezone: "Asia/Kolkata",
      shift_id: null,
      scheduled_start: null,
      scheduled_end: null,
      grace_minutes: null,
      spans_midnight: false,
      is_holiday: false,
      day_end: new Date(now.getTime() + 60_000).toISOString(),
    },
    sessions: [],
    adjustments: [],
  };

  const response = await readTimeline(new Request("https://nova.test/api/work/timeline"));
  const result = await response.json() as Record<string, any>;

  expect(response.status).toBe(200);
  expect(result.exceptions).toContainEqual(expect.objectContaining({
    type: "work.untracked_gap",
    actionable: false,
  }));
  expect(queries).toHaveLength(2);
});

test("timeline read denies an out-of-scope person before loading timeline data", async () => {
  reset();
  timelineAccessAllowed = false;
  const response = await readTimeline(new Request(
    `https://nova.test/api/work/timeline?personId=${targetPersonId}&date=2026-10-11`,
  ));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "PERMISSION_DENIED" });
  expect(queries).toHaveLength(1);
  expect(queries[0].values).toEqual([actorId, targetPersonId, organisationId, "2026-10-11"]);
});

test("timeline read normalizes JSON timestamps and keeps events and session boundaries", async () => {
  reset();
  timelineData = {
    attendance: {
      id: "attendance-1",
      business_date: "2026-10-11",
      mode: "office",
      checked_in_at: "2026-10-11T10:00:00+00:00",
      checked_out_at: "2026-10-11T11:00:00+00:00",
      closure_reason: null,
      boundary_at: "2026-10-12T18:29:59.999Z",
    },
    attendance_policy: {
      mode: "hour_based",
      required_attendance_minutes: 480,
      timezone: "Asia/Kolkata",
      shift_id: null,
      scheduled_start: null,
      scheduled_end: null,
      grace_minutes: null,
      spans_midnight: false,
      is_holiday: false,
      day_end: "2026-10-11T18:29:59.999Z",
    },
    sessions: [{
      id: "session-1",
      assignment_id: "assignment-1",
      task_id: "task-1",
      title: "Example work",
      started_at: "2026-10-11T10:15:00+00:00",
      ended_at: "2026-10-11T10:45:00+00:00",
      state: "completed",
      closure_reason: null,
      boundary_at: "2026-10-12T18:29:59.999Z",
    }],
    adjustments: [{
      id: "adjustment-1",
      assignment_id: "assignment-1",
      started_at: "2026-10-11T10:45:00+00:00",
      ended_at: "2026-10-11T10:50:00+00:00",
      reason: "approved",
    }],
  };

  const response = await readTimeline(new Request("https://nova.test/api/work/timeline?date=2026-10-11"));
  const result = await response.json() as Record<string, any>;

  expect(response.status).toBe(200);
  expect(result.attendanceSummary).toEqual({ durationMinutes: 60, requiredMinutes: 480, requirementSatisfied: false });
  expect(result.attendance.checked_in_at).toBe("2026-10-11T10:00:00.000Z");
  expect(result.sessions[0].started_at).toBe("2026-10-11T10:15:00.000Z");
  expect(result.events.map((event: { type: string }) => event.type)).toEqual([
    "attendance.check_in",
    "work.started",
    "work.ended",
    "work.adjustment.started",
    "work.adjustment.ended",
    "attendance.check_out",
  ]);
});

test("timeline rejects malformed dates before running database queries", async () => {
  reset();
  const response = await readTimeline(new Request("https://nova.test/api/work/timeline?date=2026-02-30"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "TIMELINE_DATE_INVALID" });
  expect(queries).toHaveLength(0);
});
