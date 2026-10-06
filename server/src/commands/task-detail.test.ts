import { expect, test } from "bun:test";
import { taskDetailAssignmentsReadSql, taskDetailReadSql } from "./task-detail.js";

test("task detail is organization-bound and filters by exact effective tasks.view before projection", () => {
  const sql = taskDetailReadSql.toUpperCase();
  expect(sql).toContain("TASKS.ORGANISATION_ID = $1");
  expect(sql).toContain("TASKS.ID = $3");
  expect(sql).toContain("NOVA.PERSON_BUSINESS_DATE($2)");
  expect(sql).toContain("ASSIGNMENTS.EFFECTIVE_ON <= ACTOR_DATE.BUSINESS_DATE");
  expect(sql).toContain("ROLES.ARCHIVED_AT IS NULL");
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'TASKS.VIEW'");
  expect(sql).toContain("GRANTS.SCOPE = 'ASSIGNED_WORK' AND EXISTS");
  expect(sql).toContain("ACTOR_ASSIGNMENTS.TASK_ID = TASKS.ID");
  expect(sql).toContain("LIMIT 1");
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
});

test("assignment detail omits email and narrows assigned_work-only viewers to their own row", () => {
  const sql = taskDetailAssignmentsReadSql.toUpperCase();
  expect(sql).toContain("ASSIGNMENTS.ORGANISATION_ID = $1");
  expect(sql).toContain("ASSIGNMENTS.TASK_ID = $2");
  expect(sql).toContain("($3::BOOLEAN OR ASSIGNMENTS.PERSON_ID = $4)");
  expect(sql).toContain("PEOPLE.DISPLAY_NAME AS PERSON_NAME");
  expect(sql).not.toContain("EMAIL");
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
});
