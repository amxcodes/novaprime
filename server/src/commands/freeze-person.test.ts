import { expect, test } from "bun:test";
import { canFreezePersonSql, freezeNotificationRecipientsSql } from "./freeze-person.js";

test("freeze authorization matches active target office and department scopes", () => {
  const sql = canFreezePersonSql.toLowerCase();
  expect(sql).toContain("grants.scope = 'organisation'");
  expect(sql).toContain("grants.scope = 'office'");
  expect(sql).toContain("target_offices.person_id = $2");
  expect(sql).toContain("target_offices.office_id = grants.office_id");
  expect(sql).toContain("target_offices.effective_on <= nova.person_business_date($2)");
  expect(sql).toContain("grants.scope = 'organisation_department'");
  expect(sql).toContain("target_departments.person_id = $2");
  expect(sql).toContain("target_departments.organisation_department_id = grants.organisation_department_id");
  expect(sql).toContain("target_departments.effective_on <= nova.person_business_date($2)");
});

test("freeze notices reach admins with effective scopes covering the frozen person", () => {
  const sql = freezeNotificationRecipientsSql.toLowerCase();
  expect(sql).toContain("grants.scope = 'organisation'");
  expect(sql).toContain("grants.scope = 'office'");
  expect(sql).toContain("target_offices.person_id = $1");
  expect(sql).toContain("grants.scope = 'organisation_department'");
  expect(sql).toContain("target_departments.person_id = $1");
});
