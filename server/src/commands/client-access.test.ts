import { expect, test } from "bun:test";
import {
  clientAccessManagePermissionSql,
  clientMembershipReadSql,
  parseClientMembershipPage,
  validClientMembershipEndDate,
} from "./client-access.js";

const clientId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";

function request(query = ""): Request {
  return new Request(`https://nova.test/api/clients/${clientId}/members${query}`);
}

test("client membership pages are bounded and cursors cannot be replayed across clients", () => {
  expect(parseClientMembershipPage(request(), clientId)).toEqual({ limit: 50, cursorDate: null, cursorId: null });
  expect(parseClientMembershipPage(request("?limit=100"), clientId)?.limit).toBe(100);
  expect(parseClientMembershipPage(request("?limit=0"), clientId)).toBeUndefined();
  expect(parseClientMembershipPage(request("?limit=101"), clientId)).toBeUndefined();
  expect(parseClientMembershipPage(request(`?cursor=2026-10-01~${membershipId}~${clientId}`), clientId)).toEqual({
    limit: 50,
    cursorDate: "2026-10-01",
    cursorId: membershipId,
  });
  expect(parseClientMembershipPage(request(`?cursor=2026-10-01~${membershipId}~00000000-0000-4000-8000-000000000099`), clientId)).toBeUndefined();
  expect(parseClientMembershipPage(request(`?cursor=2026-02-30~${membershipId}~${clientId}`), clientId)).toBeUndefined();
});

test("membership reads remain client and organisation scoped with stable effective-date ordering", () => {
  const sql = clientMembershipReadSql.toUpperCase();
  expect(sql).toContain("MEMBERSHIPS.CLIENT_ID = $1");
  expect(sql).toContain("MEMBERSHIPS.ORGANISATION_ID = $2");
  expect(sql).toContain("(MEMBERSHIPS.EFFECTIVE_ON, MEMBERSHIPS.ID) < ($3::DATE, $4::UUID)");
  expect(sql).toContain("ORDER BY MEMBERSHIPS.EFFECTIVE_ON DESC, MEMBERSHIPS.ID DESC");
  expect(sql).toContain("LIMIT $5");
  expect(sql).toContain("PEOPLE.DISPLAY_NAME AS PERSON_NAME");
  expect(sql).not.toContain("PEOPLE.EMAIL");
});

test("membership management permission is effective-dated and bound to actor organisation and client scope", () => {
  const sql = clientAccessManagePermissionSql.toUpperCase();
  expect(sql).toContain("ASSIGNMENTS.PERSON_ID = $1");
  expect(sql).toContain("ROLES.ORGANISATION_ID = $4");
  expect(sql).toContain("ASSIGNMENTS.EFFECTIVE_ON <= NOVA.PERSON_BUSINESS_DATE($1)");
  expect(sql).toContain("ROLES.ARCHIVED_AT IS NULL");
  expect(sql).toContain("GRANTS.PERMISSION_KEY = $2");
  expect(sql).toContain("GRANTS.CLIENT_ID = $3");
});

test("membership end dates cannot rewrite periods before their start or the actor's business date", () => {
  expect(validClientMembershipEndDate("2026-10-02", "2026-10-01", "2026-10-01")).toBe(true);
  expect(validClientMembershipEndDate("2026-09-30", "2026-10-01", "2026-10-01")).toBe(false);
  expect(validClientMembershipEndDate("2026-10-01", "2026-10-01", "2026-10-02")).toBe(false);
  expect(validClientMembershipEndDate("2026-02-30", "2026-02-01", "2026-02-01")).toBe(false);
});
