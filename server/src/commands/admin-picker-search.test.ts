import { expect, mock, test } from "bun:test";

mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));

const {
  eligibleOwnerTransferPeopleSql,
  ownerTransferPermissionSql,
  organisationPermissionSql,
  parseAdminOnboardingPickerSearch,
  parseEligibleOwnerSearch,
} = await import("./admin-picker-search.js");

const personId = "00000000-0000-4000-8000-000000000001";

test("onboarding picker filters are bounded, literal, and kind-specific", () => {
  const base = "https://nova.test/api/people/onboarding-options";
  expect(parseAdminOnboardingPickerSearch(new Request(`${base}?kind=role&q=%20A%25_%5C%20`))).toEqual({
    kind: "role",
    personId: null,
    query: "A%_\\",
    pattern: "%A^%^_^\\%",
  });
  expect(parseAdminOnboardingPickerSearch(new Request(`${base}?kind=manager&q=alex&personId=${personId}`)))
    .toMatchObject({ kind: "manager", personId, query: "alex" });

  for (const query of [
    "?kind=role&kind=manager",
    "?kind=role&q=one&q=two",
    "?kind=unknown",
    "?kind=manager",
    "?kind=manager&personId=not-a-uuid",
    `?kind=office&personId=${personId}`,
    "?kind=role&unexpected=x",
    `?kind=role&q=${"x".repeat(101)}`,
  ]) {
    expect(parseAdminOnboardingPickerSearch(new Request(base + query))).toBeUndefined();
  }
});

test("owner-transfer search rejects ambiguous and unrelated filters", () => {
  const base = "https://nova.test/api/organisation/owner-transfer/eligible-people";
  expect(parseEligibleOwnerSearch(new Request(`${base}?q=%20Alex%20`))).toEqual({
    query: "Alex",
    pattern: "%Alex%",
  });
  for (const query of ["?q=a&q=b", "?kind=active", `?q=${"x".repeat(101)}`]) {
    expect(parseEligibleOwnerSearch(new Request(base + query))).toBeUndefined();
  }
});

test("onboarding option searches require exact organization grants and query only bounded eligible options", () => {
  const permissionSql = organisationPermissionSql.toUpperCase();
  expect(permissionSql).toContain("GRANTS.PERMISSION_KEY = $2");
  expect(permissionSql).toContain("GRANTS.SCOPE = 'ORGANISATION'");
  expect(permissionSql).toContain("NOVA.PERSON_BUSINESS_DATE($1)");

  expect(organisationPermissionSql).not.toContain("OR grants.scope");
  const ownerSql = eligibleOwnerTransferPeopleSql.toUpperCase();
  expect(ownerSql).toContain("PEOPLE.ORGANISATION_ID = $1");
  expect(ownerSql).toContain("STATUS_PERIOD.STATUS IN ('ACTIVE', 'NOTICE')");
  expect(ownerSql).toContain("PEOPLE.ID <> $2");
  expect(ownerSql).toContain("NOT EXISTS (");
  expect(ownerSql).toContain("ROLES.KEY = 'SUPER_ADMIN'");
  expect(ownerSql).toContain("ILIKE $3 ESCAPE '^'");
  expect(ownerSql).toContain("LIMIT $4");
});

test("owner transfer option search binds Super Admin and organization people access", () => {
  const permissionSql = ownerTransferPermissionSql.toUpperCase();
  expect(permissionSql).toContain("NOVA.REQUEST_ACTOR_IS_SUPER_ADMIN() AS IS_SUPER_ADMIN");
  expect(permissionSql).toContain("GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
  expect(permissionSql).toContain("GRANTS.SCOPE = 'ORGANISATION'");
});
