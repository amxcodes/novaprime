import { expect, test } from "bun:test";
import {
  parseRoleScopeTargetSearch,
  roleScopeTargetPermissionSql,
  roleScopeTargetSql,
  roleTargetScopes,
} from "./role-scope-targets-model.js";

const base = "https://nova.test/api/roles/scope-targets";

test("requires one supported scope, accepts one bounded search, and normalizes text", () => {
  expect(parseRoleScopeTargetSearch(new Request(`${base}?scope=client&q=%20North%20`))).toEqual({
    scope: "client",
    query: "north",
    limit: 30,
  });
  expect(roleTargetScopes).toEqual([
    "office", "organisation_department", "client", "client_workstream", "group",
  ]);
  expect(parseRoleScopeTargetSearch(new Request(`${base}?scope=client`))).toEqual({
    scope: "client",
    query: "",
    limit: 30,
  });
  for (const query of [
    "?scope=client&scope=group", "?scope=invalid",
    "?scope=client&q=a&q=b", `?scope=client&q=${"x".repeat(101)}`,
  ]) {
    expect(parseRoleScopeTargetSearch(new Request(base + query))).toBeUndefined();
  }
});

test("the selector read is role-view gated and each static query returns only active scoped IDs and names", () => {
  const permission = roleScopeTargetPermissionSql.toUpperCase();
  expect(permission).toContain("GRANTS.PERMISSION_KEY = 'ROLES.VIEW'");
  expect(permission).toContain("GRANTS.SCOPE = 'ORGANISATION'");
  expect(permission).toContain("ROLES.ORGANISATION_ID = $2");
  expect(permission).toContain("ASSIGNMENTS.EFFECTIVE_UNTIL IS NULL OR ASSIGNMENTS.EFFECTIVE_UNTIL >= NOVA.PERSON_BUSINESS_DATE($1)");

  for (const scope of roleTargetScopes) {
    const sql = roleScopeTargetSql(scope).toUpperCase();
    expect(sql).toContain("TARGETS.ID");
    expect(sql).toContain("TARGETS.NAME");
    expect(sql).toContain("TARGETS.ORGANISATION_ID = $1");
    expect(sql).toContain("TARGETS.ARCHIVED_AT IS NULL");
    expect(sql).toContain("POSITION($2 IN LOWER(TARGETS.NAME)) > 0");
    expect(sql).toContain("LIMIT $3");
    expect(sql).not.toContain("SELECT *");
    expect(sql).not.toContain("EMAIL");
  }
  expect(roleScopeTargetSql("client_workstream").toUpperCase()).toContain("CLIENTS.ARCHIVED_AT IS NULL");
  expect(roleScopeTargetSql("group").toUpperCase()).toContain("ORGANISATION_WORKSTREAMS");
});
