import { expect, test } from "bun:test";
import { parsePersonHistoryPage, personHistoryReadSql } from "./person-history.js";

const personId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";

function request(query = ""): Request {
  return new Request(`https://nova.test/api/people/${personId}/history${query}`);
}

test("person history pagination is bounded and validates a person-bound stable cursor", () => {
  expect(parsePersonHistoryPage(request(), personId)).toEqual({
    limit: 50,
    cursorAt: null,
    cursorKind: null,
    cursorId: null,
  });
  expect(parsePersonHistoryPage(request("?limit=100"), personId)?.limit).toBe(100);
  expect(parsePersonHistoryPage(request("?limit=101"), personId)).toBeUndefined();
  expect(parsePersonHistoryPage(request(`?cursor=2026-10-02%2010%3A23%3A12.123456%2B00~office~${eventId}~${personId}`), personId)).toEqual({
    limit: 50,
    cursorAt: "2026-10-02 10:23:12.123456+00",
    cursorKind: "office",
    cursorId: eventId,
  });
  expect(parsePersonHistoryPage(request(`?cursor=2026-10-02%2010%3A23%3A12.123456%2B00~other~${eventId}~${personId}`), personId)).toBeUndefined();
  expect(parsePersonHistoryPage(request(`?cursor=2026-10-02%2010%3A23%3A12.123456%2B00~office~${eventId}~00000000-0000-4000-8000-000000000099`), personId)).toBeUndefined();
  expect(parsePersonHistoryPage(request("?cursor=2026-02-30%2010%3A23%3A12.123456%2B00~office~" + eventId + "~" + personId), personId)).toBeUndefined();
});

test("person history SQL authorizes the exact target by current people.view scope before history projection", () => {
  const sql = personHistoryReadSql.toUpperCase();
  expect(sql).toContain("TARGET.ORGANISATION_ID = $1");
  expect(sql).toContain("TARGET.ID = $3");
  expect(sql).toContain("ACTOR_ROLES.ORGANISATION_ID = $1");
  expect(sql).toContain("ACTOR_GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
  expect(sql).toContain("ACTOR_ASSIGNMENTS.EFFECTIVE_ON <= ACTOR_DATE.BUSINESS_DATE");
  expect(sql).toContain("ACTOR_ROLES.ARCHIVED_AT IS NULL");
  expect(sql).toContain("ACTOR_GRANTS.SCOPE = 'ORGANISATION'");
  expect(sql).toContain("ACTOR_GRANTS.OFFICE_ID = CURRENT_OFFICE.OFFICE_ID");
  expect(sql).toContain("ACTOR_GRANTS.ORGANISATION_DEPARTMENT_ID = CURRENT_DEPARTMENT.DEPARTMENT_ID");
  expect(sql).toContain("TARGET.ID = $2");
  expect(sql).toContain("JOIN NOVA.PERSON_STATUS_PERIODS");
  expect(sql).toContain("JOIN NOVA.EMPLOYMENT_TERMS");
  expect(sql).toContain("JOIN NOVA.PERSON_OFFICE_ASSIGNMENTS");
  expect(sql).toContain("JOIN NOVA.PERSON_DEPARTMENT_ASSIGNMENTS");
  expect(sql).toContain("JOIN NOVA.PERSON_ROLE_ASSIGNMENTS");
  expect(sql).not.toContain("PERSON_IDENTITIES");
  expect(sql).not.toContain("TOKEN_HASH");
});

test("person history uses keyset pagination consistent with its deterministic mixed-direction ordering", () => {
  const sql = personHistoryReadSql.toUpperCase();
  expect(sql).toContain("HISTORY_ROWS.SORT_AT DESC, HISTORY_ROWS.KIND ASC, HISTORY_ROWS.ID ASC");
  expect(sql).toContain("HISTORY_ROWS.SORT_AT < $4::TIMESTAMPTZ");
  expect(sql).toContain("HISTORY_ROWS.KIND > $5::TEXT");
  expect(sql).toContain("HISTORY_ROWS.ID > $6::UUID");
  expect(sql).toContain("LIMIT $7");
});
