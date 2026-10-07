import { expect, test } from "bun:test";
import {
  parsePeopleDirectoryPage,
  peopleDirectoryPermissionScopes,
  peopleDirectoryReadSql,
  projectPeopleDirectoryPage,
  projectPersonDirectoryRecord,
  projectAuthorizedPeopleDirectoryRows,
} from "./people-directory-model.js";

const personId = "00000000-0000-4000-8000-000000000001";

test("directory paging bounds page size and binds cursors to the normalized literal query", () => {
  const base = "https://nova.test/api/people/directory";
  expect(parsePeopleDirectoryPage(new Request(base))).toMatchObject({
    limit: 25,
    query: "",
    searchPattern: null,
    cursorName: null,
    cursorPersonId: null,
  });

  const filters = parsePeopleDirectoryPage(new Request(`${base}?limit=10&q=%20A%25_%5C%20`));
  expect(filters).toMatchObject({
    limit: 10,
    query: "a%_\\",
    searchPattern: "%a^%^_^\\%",
  });
  if (!filters) throw new Error("Expected a valid page");

  const cursor = `${encodeURIComponent("Aman ~").replace(/~/g, "%7E")}~${personId}~${filters.cursorBinding}`;
  expect(parsePeopleDirectoryPage(new Request(`${base}?q=a%25_%5C&cursor=${encodeURIComponent(cursor)}`)))
    .toMatchObject({ cursorName: "Aman ~", cursorPersonId: personId, query: filters.query });
  expect(parsePeopleDirectoryPage(new Request(`${base}?q=other&cursor=${encodeURIComponent(cursor)}`))).toBeUndefined();

  for (const query of [
    "?limit=0", "?limit=51", "?limit=1.5", "?limit=10&limit=11", "?q=a&q=b",
    `?cursor=${encodeURIComponent(`Aman~${personId}~wrong`)}`,
    `?cursor=${encodeURIComponent(`Aman~${personId}~${filters.cursorBinding}`)}&q=other`,
    `?cursor=${encodeURIComponent(`Aman~not-a-uuid~${filters.cursorBinding}`)}`,
    `?q=${"x".repeat(101)}`,
  ]) {
    expect(parsePeopleDirectoryPage(new Request(base + query))).toBeUndefined();
  }
});

test("directory authorization uses only catalogue scopes and filters the target scope before paging", () => {
  expect(peopleDirectoryPermissionScopes).toEqual([
    "organisation", "office", "organisation_department",
  ]);
  const sql = peopleDirectoryReadSql.toUpperCase();
  expect(sql).toContain("ACTOR_PERMISSION_GRANTS AS MATERIALIZED");
  expect(sql).toContain("SELECT ACTOR_PERMISSION.PERMITTED AS PERMISSION_GRANTED");
  expect(sql).toContain("LEFT JOIN PAGE_PEOPLE ON ACTOR_PERMISSION.PERMITTED");
  expect(sql).toContain("ACTOR_ROLES.ORGANISATION_ID = $1");
  expect(sql).toContain("ACTOR_GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
  expect(sql).toContain("ACTOR_GRANTS.SCOPE = ANY(ARRAY['ORGANISATION','OFFICE','ORGANISATION_DEPARTMENT']::NOVA.PERMISSION_SCOPE[])");
  expect(sql).toContain("ACTOR_GRANTS.OFFICE_ID = OFFICE.ID");
  expect(sql).toContain("ACTOR_GRANTS.ORGANISATION_DEPARTMENT_ID = DEPARTMENT.ID");
  expect(sql).toContain("($7::UUID IS NULL OR PEOPLE.ID = $7::UUID)");
  expect(sql).not.toContain("OWN_RECORD");

  const scope = sql.indexOf("ACTOR_GRANTS.SCOPE = ANY(");
  const targetScope = sql.indexOf("ACTOR_GRANTS.OFFICE_ID = OFFICE.ID");
  const cursor = sql.indexOf("($4::TEXT IS NULL");
  const limit = sql.indexOf("LIMIT $6");
  expect(scope).toBeGreaterThan(-1);
  expect(scope).toBeLessThan(cursor);
  expect(targetScope).toBeGreaterThan(-1);
  expect(targetScope).toBeLessThan(cursor);
  expect(cursor).toBeLessThan(limit);
  expect(sql).toContain("ELIGIBLE_PEOPLE AS (");
  expect(sql).toContain("PAGE_PEOPLE AS MATERIALIZED");
  const pageOrder = sql.indexOf('ORDER BY SORT_NAME COLLATE "C", ID');
  expect(pageOrder).toBeGreaterThan(cursor);
  expect(pageOrder).toBeLessThan(limit);
  expect(sql).toContain('ORDER BY PAGE_PEOPLE.SORT_NAME COLLATE "C", PAGE_PEOPLE.ID');
});

test("one directory query preserves denied, empty, and populated access results", () => {
  const denied = projectAuthorizedPeopleDirectoryRows([{
    permission_granted: false,
    id: null,
    display_name: null,
    email: null,
    status: null,
    designation: null,
    employment_starts_on: null,
    manager_name: null,
    office_id: null,
    office_name: null,
    department_id: null,
    department_name: null,
    role_id: null,
    role_name: null,
    sort_name: null,
  }]);
  expect(denied).toEqual({ permissionGranted: false, people: [] });

  const empty = projectAuthorizedPeopleDirectoryRows([{
    permission_granted: true,
    id: null,
    display_name: null,
    email: null,
    status: null,
    designation: null,
    employment_starts_on: null,
    manager_name: null,
    office_id: null,
    office_name: null,
    department_id: null,
    department_name: null,
    role_id: null,
    role_name: null,
    sort_name: null,
  }]);
  expect(empty).toEqual({ permissionGranted: true, people: [] });

  const person = {
    id: personId,
    display_name: "Aman",
    email: "aman@example.test",
    status: "active",
    designation: "Engineer",
    employment_starts_on: "2026-01-01",
    manager_name: null,
    office_id: null,
    office_name: null,
    department_id: null,
    department_name: null,
    role_id: null,
    role_name: null,
    sort_name: "Aman",
    permission_granted: true,
  };
  expect(projectAuthorizedPeopleDirectoryRows([person])).toEqual({
    permissionGranted: true,
    people: [{
      id: person.id,
      display_name: person.display_name,
      email: person.email,
      status: person.status,
      designation: person.designation,
      employment_starts_on: person.employment_starts_on,
      manager_name: person.manager_name,
      office_id: person.office_id,
      office_name: person.office_name,
      department_id: person.department_id,
      department_name: person.department_name,
      role_id: person.role_id,
      role_name: person.role_name,
      sort_name: person.sort_name,
    }],
  });
});

test("directory SQL and projection expose only bounded directory fields", () => {
  const sql = peopleDirectoryReadSql.toUpperCase();
  expect(sql).toContain("PEOPLE.EMAIL");
  expect(sql).toContain("CONCAT_WS(' ', DISPLAY_NAME, EMAIL, DESIGNATION, OFFICE_NAME");
  expect(sql).not.toContain("INVITATION");
  expect(sql).not.toContain("CANRECEIVEASSIGNMENTS");
  expect(sql).not.toContain("HISTORY");

  const filters = parsePeopleDirectoryPage(new Request("https://nova.test/api/people/directory?limit=1"));
  if (!filters) throw new Error("Expected a valid page");
  const rows = [
    {
      id: personId, display_name: null, status: "active", designation: "Engineer",
      employment_starts_on: "2026-01-01", manager_name: null, office_id: null, office_name: null,
      department_id: null, department_name: null, role_id: "role-1", role_name: "Member",
      sort_name: "", email: "aman@example.test", invitation_email: "should not escape",
    },
    {
      id: "00000000-0000-4000-8000-000000000002", display_name: "Aman", status: "active",
      designation: null, employment_starts_on: null, manager_name: null, office_id: null,
      office_name: null, department_id: null, department_name: null, role_id: null, role_name: null,
      sort_name: "Aman", email: "other@example.test",
    },
  ] as never[];
  const page = projectPeopleDirectoryPage(rows, filters);
  expect(page).toMatchObject({ hasMore: true, limit: 1, people: [{ id: personId, displayName: null, email: "aman@example.test" }] });
  expect(page.people[0]).not.toHaveProperty("invitation");
  expect(page.people[0]).not.toHaveProperty("canReceiveAssignments");
  expect(page.nextCursor).toBeTruthy();
  expect(parsePeopleDirectoryPage(new Request(
    `https://nova.test/api/people/directory?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`,
  ))).toMatchObject({ cursorName: "", cursorPersonId: personId });
  const missingRecord = projectPersonDirectoryRecord([], filters);
  expect(missingRecord).toBeInstanceOf(Response);
  expect((missingRecord as Response).status).toBe(404);
});
