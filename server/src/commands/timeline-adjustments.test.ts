import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const actorId = "00000000-0000-4000-8000-000000000001";
const organisationId = "00000000-0000-4000-8000-000000000002";
const queries: Array<{ sql: string; values: unknown[] }> = [];
let permitted = true;
let actorAvailable = true;
let databaseFailure = false;
let assignmentRows: Array<{ assignment_id: string; title: string }> = [];

mock.module("../auth-configuration.js", () => ({ authenticationConfiguration: () => ({}) }));
mock.module("../request-actor.js", () => ({
  requestActor: async () => actorAvailable ? { context: { userId: actorId, organisationId } } : undefined,
  isNormalOperationalActor: () => true,
}));
mock.module("../db.js", () => ({
  withDatabaseRequest: async (_context: unknown, operation: (transaction: unknown) => unknown) => {
    if (databaseFailure) throw new Error("database unavailable");
    return operation({
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.includes("AS allowed")) return { rows: [{ allowed: permitted }] };
        if (sql.includes("FROM nova.task_assignments assignments")) return { rows: assignmentRows };
        throw new Error("Unexpected timeline adjustment query: " + sql);
      },
    });
  },
}));
mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));

const {
  parseTimelineCorrectionAssignmentSearch,
  searchTimelineCorrectionAssignments,
  timelineCorrectionAssignmentPermissionSql,
  timelineCorrectionAssignmentsSql,
} = await import("./timeline-adjustments.js");

function reset() {
  queries.length = 0;
  permitted = true;
  actorAvailable = true;
  databaseFailure = false;
  assignmentRows = [];
}

function assignmentRowsOf(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    assignment_id: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
    title: "Assignment " + (index + 1),
  }));
}

test("correction assignment query accepts only bounded literal query text", () => {
  const base = "https://nova.test/api/work/timeline-adjustments/assignments";
  const parsed = parseTimelineCorrectionAssignmentSearch(new Request(base + "?q=" + encodeURIComponent(" A%_^\\ ")));
  expect(parsed?.query).toBe("A%_^\\");
  expect(parsed?.pattern).toBe("%" + parsed?.query.replace(/[\\^%_]/g, "^$&") + "%");
  expect(parseTimelineCorrectionAssignmentSearch(new Request(base))).toEqual({ query: "", pattern: null });
  for (const suffix of [
    "?q=one&q=two",
    "?q=one&status=done",
    "?q=" + "x".repeat(101),
    "?q=%00",
  ]) {
    expect(parseTimelineCorrectionAssignmentSearch(new Request(base + suffix))).toBeUndefined();
  }
});

test("eligible assignment source results come from an independent bounded actor-scoped search", async () => {
  reset();
  assignmentRows = assignmentRowsOf(31);
  const response = await searchTimelineCorrectionAssignments(new Request("https://nova.test/api/work/timeline-adjustments/assignments?q=Assignment%201"));
  const result = await response.json() as Record<string, unknown>;
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(result.limit).toBe(30);
  expect(result.hasMore).toBe(true);
  expect(result.assignments as Array<Record<string, unknown>>).toHaveLength(30);
  expect((result.assignments as Array<Record<string, unknown>>)[0]).toEqual({
    assignmentId: assignmentRows[0].assignment_id,
    title: "Assignment 1",
  });

  expect(queries).toHaveLength(2);
  expect(queries[0]).toMatchObject({ sql: timelineCorrectionAssignmentPermissionSql, values: [actorId] });
  expect(queries[1]).toMatchObject({
    sql: timelineCorrectionAssignmentsSql,
    values: [organisationId, actorId, "%Assignment 1%", 31],
  });
  expect(timelineCorrectionAssignmentsSql).toContain("assignments.person_id = $2");
  expect(timelineCorrectionAssignmentsSql).toContain("tasks.organisation_id = $1");
  expect(timelineCorrectionAssignmentsSql).toContain("assignments.status <> 'cancelled'");
  expect(timelineCorrectionAssignmentsSql).toContain("tasks.status <> 'cancelled'");
  expect(timelineCorrectionAssignmentsSql).toContain("tasks.title ILIKE $3 ESCAPE '^'");
  expect(timelineCorrectionAssignmentsSql).toContain("LIMIT $4");
  expect(JSON.stringify(result)).not.toContain("person_id");
});

test("search permission matches active own-correction grant scopes and denies out-of-scope actors before assignment reads", async () => {
  reset();
  permitted = false;
  const response = await searchTimelineCorrectionAssignments(new Request("https://nova.test/api/work/timeline-adjustments/assignments"));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "PERMISSION_DENIED" });
  expect(queries).toHaveLength(1);
  expect(queries[0].values).toEqual([actorId]);

  const permissionSql = timelineCorrectionAssignmentPermissionSql;
  expect(permissionSql).toContain("grants.permission_key = 'work.timeline_adjust_own'");
  expect(permissionSql).toContain("grants.scope IN ('organisation', 'own_record')");
  expect(permissionSql).toContain("grants.scope = 'office'");
  expect(permissionSql).toContain("grants.scope = 'organisation_department'");
  expect(permissionSql).toContain("role_assignments.effective_on <= nova.person_business_date($1)");
  expect(permissionSql).toContain("roles.archived_at IS NULL");
  expect(permissionSql).not.toContain("grants.scope = 'client'");
});

test("invalid search, missing actor, and database failures never produce assignment options", async () => {
  reset();
  const invalid = await searchTimelineCorrectionAssignments(new Request("https://nova.test/api/work/timeline-adjustments/assignments?status=done"));
  expect(invalid.status).toBe(400);
  expect(queries).toHaveLength(0);

  actorAvailable = false;
  const unauthorized = await searchTimelineCorrectionAssignments(new Request("https://nova.test/api/work/timeline-adjustments/assignments"));
  expect(unauthorized.status).toBe(401);
  expect(queries).toHaveLength(0);

  actorAvailable = true;
  databaseFailure = true;
  const failed = await searchTimelineCorrectionAssignments(new Request("https://nova.test/api/work/timeline-adjustments/assignments?q=Report"));
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "INTERNAL_ERROR" });
});

test("GET route is registered separately from the unchanged correction write command", () => {
  const source = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
  expect(source).toMatch(/request\.method === "GET" && commandPath === "\/work\/timeline-adjustments\/assignments"[\s\S]*?searchTimelineCorrectionAssignments\(request\)/);
  expect(source).toMatch(/request\.method === "POST" && commandPath === "\/work\/timeline-adjustments"[\s\S]*?createTimelineAdjustment\(request\)/);
});
