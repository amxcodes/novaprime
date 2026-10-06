const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
export const peopleDirectoryPermissionScopes = [
  "organisation",
  "office",
  "organisation_department",
] as const;
const directoryPermissionScopeArraySql = `ARRAY[${peopleDirectoryPermissionScopes.map((scope) => `'${scope}'`).join(",")}]::nova.permission_scope[]`;
export const peopleDirectoryPersonIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultPageLimit = 25;
const maximumPageLimit = 50;

export type PeopleDirectoryPageFilters = Readonly<{
  limit: number;
  query: string;
  searchPattern: string | null;
  cursorName: string | null;
  cursorPersonId: string | null;
  cursorBinding: string;
}>;

export function peopleDirectoryCursorBinding(query: string): string {
  return Array.from(new TextEncoder().encode(JSON.stringify(["people-directory-v1", query])),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parsePeopleDirectoryPage(request: Request): PeopleDirectoryPageFilters | undefined {
  const params = new URL(request.url).searchParams;
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1 || params.getAll("q").length > 1) {
    return undefined;
  }

  const rawLimit = params.get("limit");
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) return undefined;
  const limit = rawLimit === null ? defaultPageLimit : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumPageLimit) return undefined;

  const query = (params.get("q") ?? "").normalize("NFC").trim().toLowerCase();
  if (query.length > 100 || query.includes("\u0000")) return undefined;
  const searchPattern = query
    ? `%${query.replace(/[\\^%_]/g, "^$&")}%`
    : null;
  const binding = peopleDirectoryCursorBinding(query);
  const rawCursor = params.get("cursor");
  if (rawCursor === null) {
    return { limit, query, searchPattern, cursorName: null, cursorPersonId: null, cursorBinding: binding };
  }

  if (rawCursor.length > 8192) return undefined;
  const [encodedName, personId, cursorBindingValue, ...extra] = rawCursor.split("~");
  let name: string;
  try { name = decodeURIComponent(encodedName ?? ""); }
  catch { return undefined; }
  if (extra.length || encodedName === undefined || name.length > 1000 ||
      !personId || !peopleDirectoryPersonIdPattern.test(personId) || cursorBindingValue !== binding) return undefined;
  return { limit, query, searchPattern, cursorName: name, cursorPersonId: personId, cursorBinding: binding };
}

export const peopleDirectoryPermissionReadSql = `SELECT EXISTS (
  SELECT 1
  FROM nova.people actor
  JOIN nova.person_role_assignments assignments ON assignments.person_id = actor.id
  JOIN nova.roles roles ON roles.id = assignments.role_id AND roles.organisation_id = $2
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE actor.id = $1 AND actor.organisation_id = $2
    AND assignments.effective_on <= nova.person_business_date($1)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
    AND roles.archived_at IS NULL
    AND grants.permission_key = 'people.view'
    AND grants.scope = ANY(${directoryPermissionScopeArraySql})
) AS permitted`;

export const peopleDirectoryReadSql = `WITH eligible_people AS (
  SELECT people.id, people.display_name, people.email, status_period.status,
         employment.designation, employment.employment_starts_on, manager.display_name AS manager_name,
         office.id AS office_id, office.name AS office_name,
         department.id AS department_id, department.name AS department_name,
         role.id AS role_id, role.name AS role_name,
         LEFT(COALESCE(people.display_name, ''), 500) AS sort_name
  FROM nova.people people
  LEFT JOIN LATERAL (
    SELECT status
    FROM nova.person_status_periods periods
    WHERE periods.person_id = people.id AND periods.ended_at IS NULL
    ORDER BY periods.effective_at DESC
    LIMIT 1
  ) status_period ON true
  LEFT JOIN LATERAL (
    SELECT designation, employment_starts_on, manager_person_id
    FROM nova.employment_terms terms
    WHERE terms.person_id = people.id AND terms.employment_ends_on IS NULL
    ORDER BY terms.employment_starts_on DESC
    LIMIT 1
  ) employment ON true
  LEFT JOIN nova.people manager ON manager.id = employment.manager_person_id
    AND manager.organisation_id = people.organisation_id
  LEFT JOIN LATERAL (
    SELECT offices.id, offices.name
    FROM nova.person_office_assignments assignments
    JOIN nova.offices offices ON offices.id = assignments.office_id
      AND offices.organisation_id = people.organisation_id
    WHERE assignments.person_id = people.id
      AND assignments.effective_on <= nova.person_business_date(people.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
    ORDER BY assignments.effective_on DESC, assignments.id DESC
    LIMIT 1
  ) office ON true
  LEFT JOIN LATERAL (
    SELECT departments.id, departments.name
    FROM nova.person_department_assignments assignments
    JOIN nova.organisation_departments departments ON departments.id = assignments.organisation_department_id
      AND departments.organisation_id = people.organisation_id
    WHERE assignments.person_id = people.id
      AND assignments.effective_on <= nova.person_business_date(people.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
    ORDER BY assignments.effective_on DESC, assignments.id DESC
    LIMIT 1
  ) department ON true
  LEFT JOIN LATERAL (
    SELECT roles.id, roles.name
    FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
      AND roles.organisation_id = people.organisation_id
    WHERE assignments.person_id = people.id
      AND assignments.effective_on <= nova.person_business_date(people.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
    ORDER BY assignments.effective_on DESC, assignments.id DESC
    LIMIT 1
  ) role ON true
  WHERE people.organisation_id = $1
    AND ($7::uuid IS NULL OR people.id = $7::uuid)
    AND EXISTS (
      SELECT 1
      FROM nova.person_role_assignments actor_assignments
      JOIN nova.roles actor_roles ON actor_roles.id = actor_assignments.role_id
        AND actor_roles.organisation_id = $1
      JOIN nova.role_permission_grants actor_grants ON actor_grants.role_id = actor_roles.id
      WHERE actor_assignments.person_id = $2
        AND actor_assignments.effective_on <= nova.person_business_date($2)
        AND (actor_assignments.effective_until IS NULL OR actor_assignments.effective_until >= nova.person_business_date($2))
        AND actor_roles.archived_at IS NULL
        AND actor_grants.permission_key = 'people.view'
        AND actor_grants.scope = ANY(${directoryPermissionScopeArraySql})
        AND (
          actor_grants.scope = 'organisation'
          OR (actor_grants.scope = 'office' AND actor_grants.office_id = office.id)
          OR (actor_grants.scope = 'organisation_department'
            AND actor_grants.organisation_department_id = department.id)
        )
    )
), page_people AS MATERIALIZED (
  SELECT *
  FROM eligible_people
  WHERE ($3::text IS NULL OR CONCAT_WS(' ', display_name, email, designation, office_name,
    department_name, role_name) ILIKE $3 ESCAPE '^')
    AND ($4::text IS NULL OR (sort_name COLLATE "C", id) > ($4::text COLLATE "C", $5::uuid))
  ORDER BY sort_name COLLATE "C", id
  LIMIT $6
)
SELECT id, display_name, email, status, designation, employment_starts_on, manager_name,
       office_id, office_name, department_id, department_name, role_id, role_name, sort_name
FROM page_people
ORDER BY sort_name COLLATE "C", id`;

export type PeopleDirectoryRow = Readonly<{
  id: string;
  display_name: string | null;
  email: string;
  status: string | null;
  designation: string | null;
  employment_starts_on: string | null;
  manager_name: string | null;
  office_id: string | null;
  office_name: string | null;
  department_id: string | null;
  department_name: string | null;
  role_id: string | null;
  role_name: string | null;
  sort_name: string;
}>;

export function projectPeopleDirectoryPage(
  rows: readonly PeopleDirectoryRow[],
  filters: PeopleDirectoryPageFilters,
) {
  const pageRows = rows.slice(0, filters.limit);
  const hasMore = rows.length > filters.limit;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? `${encodeURIComponent(last.sort_name).replace(/~/g, "%7E")}~${last.id}~${filters.cursorBinding}`
    : null;
  return {
    people: pageRows.map((person) => ({
      id: person.id,
      displayName: person.display_name,
      email: person.email,
      status: person.status,
      designation: person.designation,
      employmentStartsOn: person.employment_starts_on,
      managerName: person.manager_name,
      office: person.office_id ? { id: person.office_id, name: person.office_name } : null,
      department: person.department_id
        ? { id: person.department_id, name: person.department_name }
        : null,
      role: person.role_id ? { id: person.role_id, name: person.role_name } : null,
    })),
    hasMore,
    nextCursor,
    limit: filters.limit,
  };
}

export function projectPersonDirectoryRecord(
  rows: readonly PeopleDirectoryRow[],
  filters: PeopleDirectoryPageFilters,
) {
  const person = projectPeopleDirectoryPage(rows, filters).people[0];
  return person ? { person } : json({ error: "PERSON_NOT_FOUND" }, 404);
}
