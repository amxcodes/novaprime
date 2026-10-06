export const availabilityPickerMaximumResults = 30;
export const availabilityPickerMaximumQueryLength = 100;

export type AvailabilityConfigurationPicker = Readonly<{
  kind: "office" | "shift";
  purpose: "calendar" | "holiday";
  query: string;
  limit: number;
}>;

export type WfhPolicyPicker = Readonly<{
  kind: "office" | "organisation_department" | "person";
  query: string;
  limit: number;
}>;

function searchParams(request: Request): { query: string; valid: boolean } {
  const params = new URL(request.url).searchParams;
  const queries = params.getAll("q");
  const query = (queries[0] ?? "").normalize("NFC").trim().toLowerCase();
  return {
    query,
    valid: queries.length <= 1 && query.length <= availabilityPickerMaximumQueryLength && !query.includes("\u0000"),
  };
}

export function parseAvailabilityConfigurationPicker(request: Request): AvailabilityConfigurationPicker | undefined {
  const params = new URL(request.url).searchParams;
  const kinds = params.getAll("kind");
  const purposes = params.getAll("purpose");
  const { query, valid } = searchParams(request);
  if (!valid || kinds.length !== 1 || purposes.length !== 1) return undefined;
  const kind = kinds[0];
  const purpose = purposes[0];
  if ((kind !== "office" && kind !== "shift") || (purpose !== "calendar" && purpose !== "holiday") ||
      (kind === "shift" && purpose !== "calendar")) return undefined;
  return { kind, purpose, query, limit: availabilityPickerMaximumResults };
}

export function parseWfhPolicyPicker(request: Request): WfhPolicyPicker | undefined {
  const params = new URL(request.url).searchParams;
  const kinds = params.getAll("kind");
  const { query, valid } = searchParams(request);
  if (!valid || kinds.length !== 1) return undefined;
  const kind = kinds[0];
  if (kind !== "office" && kind !== "organisation_department" && kind !== "person") return undefined;
  return { kind, query, limit: availabilityPickerMaximumResults };
}

export const availabilityPickerPermissionsSql = `SELECT COUNT(DISTINCT grants.permission_key)::int AS permission_count
FROM nova.person_role_assignments assignments
JOIN nova.roles roles ON roles.id = assignments.role_id
JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
WHERE assignments.person_id = $1
  AND roles.organisation_id = $2
  AND assignments.effective_on <= nova.person_business_date($1)
  AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
  AND roles.archived_at IS NULL
  AND grants.scope = 'organisation'
  AND grants.permission_key = ANY($3::text[])`;

export const availabilityOfficePickerSql = `SELECT offices.id,
       COALESCE(NULLIF(BTRIM(offices.name), ''), 'Unnamed office') AS label
FROM nova.offices offices
WHERE offices.organisation_id = $1 AND offices.archived_at IS NULL
  AND ($2 = '' OR position($2 in lower(offices.name)) > 0)
ORDER BY lower(offices.name), offices.id
LIMIT $3`;

export const availabilityShiftPickerSql = `SELECT shifts.id,
       COALESCE(NULLIF(BTRIM(shifts.name), ''), 'Unnamed shift') AS label
FROM nova.shifts shifts
WHERE shifts.organisation_id = $1 AND shifts.archived_at IS NULL
  AND ($2 = '' OR position($2 in lower(shifts.name)) > 0)
ORDER BY lower(shifts.name), shifts.id
LIMIT $3`;

export const wfhOfficePickerSql = `SELECT offices.id,
       COALESCE(NULLIF(BTRIM(offices.name), ''), 'Unnamed office') AS label
FROM nova.offices offices
WHERE offices.organisation_id = $1 AND offices.archived_at IS NULL
  AND ($2 = '' OR position($2 in lower(offices.name)) > 0)
ORDER BY lower(offices.name), offices.id
LIMIT $3`;

export const wfhDepartmentPickerSql = `SELECT departments.id,
       COALESCE(NULLIF(BTRIM(departments.name), ''), 'Unnamed department') AS label
FROM nova.organisation_departments departments
WHERE departments.organisation_id = $1 AND departments.archived_at IS NULL
  AND ($2 = '' OR position($2 in lower(departments.name)) > 0)
ORDER BY lower(departments.name), departments.id
LIMIT $3`;

export const wfhOfficeTargetWriteSql = `SELECT id FROM nova.offices
WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`;

export const wfhDepartmentTargetWriteSql = `SELECT id FROM nova.organisation_departments
WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`;

export function wfhOrganisationTargetWriteSql(kind: "office" | "organisation_department"): string {
  return kind === "office" ? wfhOfficeTargetWriteSql : wfhDepartmentTargetWriteSql;
}

/** Mirrors readPeople's current effective office/department scope, including own_record. */
export const wfhPersonPickerSql = `SELECT people.id,
       COALESCE(NULLIF(BTRIM(people.display_name), ''), NULLIF(BTRIM(people.email), ''), 'Unnamed person') AS label
FROM nova.people people
LEFT JOIN LATERAL (
  SELECT offices.id
  FROM nova.person_office_assignments assignments
  JOIN nova.offices offices ON offices.id = assignments.office_id
  WHERE assignments.person_id = people.id
    AND assignments.effective_on <= nova.person_business_date(people.id)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
  ORDER BY assignments.effective_on DESC
  LIMIT 1
) current_office ON true
LEFT JOIN LATERAL (
  SELECT departments.id
  FROM nova.person_department_assignments assignments
  JOIN nova.organisation_departments departments
    ON departments.id = assignments.organisation_department_id
  WHERE assignments.person_id = people.id
    AND assignments.effective_on <= nova.person_business_date(people.id)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
  ORDER BY assignments.effective_on DESC
  LIMIT 1
) current_department ON true
WHERE people.organisation_id = $1
  AND ($3 = '' OR position($3 in lower(COALESCE(people.display_name, '') || ' ' || COALESCE(people.email, ''))) > 0)
  AND EXISTS (
    SELECT 1
    FROM nova.person_role_assignments actor_assignments
    JOIN nova.roles actor_roles ON actor_roles.id = actor_assignments.role_id
    JOIN nova.role_permission_grants actor_grants ON actor_grants.role_id = actor_roles.id
    WHERE actor_assignments.person_id = $2
      AND actor_roles.organisation_id = $1
      AND actor_assignments.effective_on <= nova.person_business_date($2)
      AND (actor_assignments.effective_until IS NULL OR actor_assignments.effective_until >= nova.person_business_date($2))
      AND actor_roles.archived_at IS NULL
      AND actor_grants.permission_key = 'people.view'
      AND (
        actor_grants.scope = 'organisation'
        OR (actor_grants.scope = 'own_record' AND people.id = $2)
        OR (actor_grants.scope = 'office' AND actor_grants.office_id = current_office.id)
        OR (actor_grants.scope = 'organisation_department' AND actor_grants.organisation_department_id = current_department.id)
      )
  )
ORDER BY lower(COALESCE(NULLIF(BTRIM(people.display_name), ''), people.email)), people.id
LIMIT $4`;

export const wfhPersonViewAccessSql = `SELECT EXISTS (
  SELECT 1
  FROM nova.person_role_assignments assignments
  JOIN nova.roles roles ON roles.id = assignments.role_id
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE assignments.person_id = $1
    AND roles.organisation_id = $2
    AND assignments.effective_on <= nova.person_business_date($1)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
    AND roles.archived_at IS NULL
    AND grants.permission_key = 'people.view'
    AND grants.scope IN ('organisation', 'own_record', 'office', 'organisation_department')
) AS permitted`;

/** Server-side guard for the person selected by the WFH writer; the search response is not authority. */
export const wfhPersonTargetWritePermissionSql = `SELECT EXISTS (
  SELECT 1
  FROM nova.people people
  LEFT JOIN LATERAL (
    SELECT offices.id
    FROM nova.person_office_assignments assignments
    JOIN nova.offices offices ON offices.id = assignments.office_id
    WHERE assignments.person_id = people.id
      AND assignments.effective_on <= nova.person_business_date(people.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
    ORDER BY assignments.effective_on DESC
    LIMIT 1
  ) current_office ON true
  LEFT JOIN LATERAL (
    SELECT departments.id
    FROM nova.person_department_assignments assignments
    JOIN nova.organisation_departments departments
      ON departments.id = assignments.organisation_department_id
    WHERE assignments.person_id = people.id
      AND assignments.effective_on <= nova.person_business_date(people.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
    ORDER BY assignments.effective_on DESC
    LIMIT 1
  ) current_department ON true
  WHERE people.id = $3 AND people.organisation_id = $2
    AND EXISTS (
      SELECT 1
      FROM nova.person_role_assignments actor_assignments
      JOIN nova.roles actor_roles ON actor_roles.id = actor_assignments.role_id
      JOIN nova.role_permission_grants actor_grants ON actor_grants.role_id = actor_roles.id
      WHERE actor_assignments.person_id = $1
        AND actor_roles.organisation_id = $2
        AND actor_assignments.effective_on <= nova.person_business_date($1)
        AND (actor_assignments.effective_until IS NULL OR actor_assignments.effective_until >= nova.person_business_date($1))
        AND actor_roles.archived_at IS NULL
        AND actor_grants.permission_key = 'people.view'
        AND (
          actor_grants.scope = 'organisation'
          OR (actor_grants.scope = 'own_record' AND people.id = $1)
          OR (actor_grants.scope = 'office' AND actor_grants.office_id = current_office.id)
          OR (actor_grants.scope = 'organisation_department' AND actor_grants.organisation_department_id = current_department.id)
        )
    )
) AS permitted`;
