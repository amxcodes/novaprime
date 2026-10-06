import { expect, test } from "bun:test";
import { clientMembershipPeopleViewPermissionSql } from "./client-access.js";
import {
  membershipDepartmentOptionSql,
  membershipOptionsAccessSql,
  membershipPeopleOptionSql,
  membershipPeopleViewPermissionSql,
  parseClientMembershipOptionSearch,
} from "./client-membership-options.js";

const base = "https://nova.test/api/clients/00000000-0000-4000-8000-000000000001/membership-options";

test("membership option queries require one kind and bound normalized search", () => {
  expect(parseClientMembershipOptionSearch(new Request(`${base}?kind=person&q=%20Avery%20`))).toEqual({
    kind: "person",
    query: "avery",
    limit: 30,
  });
  expect(parseClientMembershipOptionSearch(new Request(`${base}?kind=department`))).toMatchObject({
    kind: "department", query: "", limit: 30,
  });
  for (const query of [
    "?kind=person&kind=department", "?kind=other", "?kind=person&q=a&q=b", `?kind=person&q=${"x".repeat(101)}`,
  ]) {
    expect(parseClientMembershipOptionSearch(new Request(base + query))).toBeUndefined();
  }
});

test("people selector options require organization people.view and return only a bounded safe projection", () => {
  const permission = membershipPeopleViewPermissionSql.toUpperCase();
  expect(permission).toContain("GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
  expect(permission).toContain("GRANTS.SCOPE = 'ORGANISATION'");
  expect(permission).toContain("ROLES.ORGANISATION_ID = $2");
  expect(permission).toContain("ASSIGNMENTS.EFFECTIVE_ON <= NOVA.PERSON_BUSINESS_DATE($1)");

  const sql = membershipPeopleOptionSql.toUpperCase();
  expect(sql).toContain("PEOPLE.ORGANISATION_ID = $1");
  expect(sql).toContain("POSITION($2 IN LOWER(COALESCE(PEOPLE.DISPLAY_NAME");
  expect(sql).toContain("LIMIT $3");
  expect(sql).toContain("AS LABEL");
  expect(sql).not.toContain("SELECT *");
  expect(sql).not.toContain("PEOPLE.STATUS");
});

test("the endpoint checks membership manage and the exact client before returning either picker", () => {
  const sql = membershipOptionsAccessSql.toUpperCase();
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'CLIENTS.MEMBERS.MANAGE'");
  expect(sql).toContain("GRANTS.SCOPE = 'ORGANISATION' OR (GRANTS.SCOPE = 'CLIENT' AND GRANTS.CLIENT_ID = $2)");
  expect(sql).toContain("ROLES.ORGANISATION_ID = $3");
  expect(sql).toContain("CLIENTS\n    WHERE ID = $2 AND ORGANISATION_ID = $3 AND ARCHIVED_AT IS NULL");
  expect(sql).toContain("AS CAN_MANAGE_MEMBERSHIPS");
  expect(sql).toContain("AS CLIENT_EXISTS");
  expect(sql).toContain("GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
  expect(sql).toContain("GRANTS.SCOPE = 'ORGANISATION'");
  expect(sql).toContain("AS CAN_VIEW_PEOPLE");
  expect(sql.match(/NOVA\.PERSON_BUSINESS_DATE\(\$1\)/g)).toHaveLength(4);
});

test("department selector options remain bound to the exact active client and organization", () => {
  const sql = membershipDepartmentOptionSql.toUpperCase();
  expect(sql).toContain("DEPARTMENTS.CLIENT_ID = $1");
  expect(sql).toContain("DEPARTMENTS.ORGANISATION_ID = $2");
  expect(sql).toContain("DEPARTMENTS.ARCHIVED_AT IS NULL");
  expect(sql).toContain("POSITION($3 IN LOWER(DEPARTMENTS.NAME)) > 0");
  expect(sql).toContain("LIMIT $4");

  const writerPermission = clientMembershipPeopleViewPermissionSql.toUpperCase();
  expect(writerPermission).toContain("GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
  expect(writerPermission).toContain("GRANTS.SCOPE = 'ORGANISATION'");
});
