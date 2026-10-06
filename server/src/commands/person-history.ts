import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}\+00$/;
const historyKinds = new Set(["status", "employment", "office", "department", "role"]);

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function validUtcTimestamp(value: string): boolean {
  if (!timestampPattern.test(value)) return false;
  const iso = value.slice(0, 23).replace(" ", "T") + "Z";
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 23) === iso.slice(0, 23);
}

export type PersonHistoryPage = Readonly<{
  limit: number;
  cursorAt: string | null;
  cursorKind: string | null;
  cursorId: string | null;
}>;

export function parsePersonHistoryPage(request: Request, personId: string): PersonHistoryPage | undefined {
  if (!uuidPattern.test(personId)) return undefined;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return undefined;

  const rawCursor = params.get("cursor");
  if (!rawCursor) return { limit, cursorAt: null, cursorKind: null, cursorId: null };
  const [cursorAt, cursorKind, cursorId, cursorPersonId, ...extra] = rawCursor.split("~");
  if (extra.length || !cursorAt || !cursorKind || !cursorId || !cursorPersonId ||
      !validUtcTimestamp(cursorAt) || !historyKinds.has(cursorKind) || !uuidPattern.test(cursorId) ||
      !uuidPattern.test(cursorPersonId) || cursorPersonId.toLowerCase() !== personId.toLowerCase()) return undefined;
  return { limit, cursorAt, cursorKind, cursorId };
}

export const personHistoryReadSql = `WITH actor_business_date AS MATERIALIZED (
  SELECT nova.person_business_date($2) AS business_date
), target_person AS MATERIALIZED (
  SELECT target.id, target.display_name,
         current_office.office_id, current_department.department_id
  FROM nova.people target
  CROSS JOIN actor_business_date actor_date
  LEFT JOIN LATERAL (
    SELECT assignments.office_id
    FROM nova.person_office_assignments assignments
    WHERE assignments.person_id = target.id
      AND assignments.effective_on <= nova.person_business_date(target.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(target.id))
    ORDER BY assignments.effective_on DESC, assignments.id DESC
    LIMIT 1
  ) current_office ON true
  LEFT JOIN LATERAL (
    SELECT assignments.organisation_department_id AS department_id
    FROM nova.person_department_assignments assignments
    WHERE assignments.person_id = target.id
      AND assignments.effective_on <= nova.person_business_date(target.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(target.id))
    ORDER BY assignments.effective_on DESC, assignments.id DESC
    LIMIT 1
  ) current_department ON true
  WHERE target.organisation_id = $1
    AND target.id = $3
    AND EXISTS (
      SELECT 1
      FROM nova.person_role_assignments actor_assignments
      JOIN nova.roles actor_roles ON actor_roles.id = actor_assignments.role_id
      JOIN nova.role_permission_grants actor_grants ON actor_grants.role_id = actor_roles.id
      WHERE actor_assignments.person_id = $2
        AND actor_roles.organisation_id = $1
        AND actor_assignments.effective_on <= actor_date.business_date
        AND (actor_assignments.effective_until IS NULL OR actor_assignments.effective_until >= actor_date.business_date)
        AND actor_roles.archived_at IS NULL
        AND actor_grants.permission_key = 'people.view'
        AND (
          actor_grants.scope = 'organisation'
          OR (actor_grants.scope = 'own_record' AND target.id = $2)
          OR (actor_grants.scope = 'office' AND actor_grants.office_id = current_office.office_id)
          OR (actor_grants.scope = 'organisation_department'
              AND actor_grants.organisation_department_id = current_department.department_id)
        )
    )
), history_rows AS (
  SELECT periods.id, 'status'::text AS kind, periods.effective_at AS sort_at,
         to_char(periods.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_on,
         CASE WHEN periods.ended_at IS NULL THEN NULL ELSE
           to_char(periods.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS effective_until,
         jsonb_strip_nulls(jsonb_build_object('status', periods.status::text, 'reason', periods.reason)) AS details
  FROM target_person target
  JOIN nova.person_status_periods periods ON periods.person_id = target.id

  UNION ALL
  SELECT terms.id, 'employment'::text, terms.employment_starts_on::timestamp AT TIME ZONE 'UTC',
         terms.employment_starts_on::text, terms.employment_ends_on::text,
         jsonb_strip_nulls(jsonb_build_object(
           'designation', terms.designation,
           'managerName', manager.display_name
         ))
  FROM target_person target
  JOIN nova.employment_terms terms ON terms.person_id = target.id
  LEFT JOIN nova.people manager
    ON manager.id = terms.manager_person_id AND manager.organisation_id = $1

  UNION ALL
  SELECT assignments.id, 'office'::text, assignments.effective_on::timestamp AT TIME ZONE 'UTC',
         assignments.effective_on::text, assignments.effective_until::text,
         jsonb_build_object('officeId', offices.id, 'officeName', offices.name)
  FROM target_person target
  JOIN nova.person_office_assignments assignments ON assignments.person_id = target.id
  JOIN nova.offices offices ON offices.id = assignments.office_id AND offices.organisation_id = $1

  UNION ALL
  SELECT assignments.id, 'department'::text, assignments.effective_on::timestamp AT TIME ZONE 'UTC',
         assignments.effective_on::text, assignments.effective_until::text,
         jsonb_build_object('departmentId', departments.id, 'departmentName', departments.name)
  FROM target_person target
  JOIN nova.person_department_assignments assignments ON assignments.person_id = target.id
  JOIN nova.organisation_departments departments
    ON departments.id = assignments.organisation_department_id AND departments.organisation_id = $1

  UNION ALL
  SELECT assignments.id, 'role'::text, assignments.effective_on::timestamp AT TIME ZONE 'UTC',
         assignments.effective_on::text, assignments.effective_until::text,
         jsonb_build_object('roleId', roles.id, 'roleName', roles.name, 'roleArchived', roles.archived_at IS NOT NULL)
  FROM target_person target
  JOIN nova.person_role_assignments assignments ON assignments.person_id = target.id
  JOIN nova.roles ON roles.id = assignments.role_id AND roles.organisation_id = $1
)
SELECT target.id AS person_id, target.display_name AS person_name,
       history.id, history.kind, history.effective_on, history.effective_until, history.details,
       to_char(history.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' AS cursor_at
FROM target_person target
LEFT JOIN LATERAL (
  SELECT history_rows.*
  FROM history_rows
  WHERE $4::timestamptz IS NULL
     OR history_rows.sort_at < $4::timestamptz
     OR (history_rows.sort_at = $4::timestamptz AND history_rows.kind > $5::text)
     OR (history_rows.sort_at = $4::timestamptz AND history_rows.kind = $5::text AND history_rows.id > $6::uuid)
  ORDER BY history_rows.sort_at DESC, history_rows.kind ASC, history_rows.id ASC
  LIMIT $7
) history ON true
ORDER BY history.sort_at DESC NULLS LAST, history.kind ASC NULLS LAST, history.id ASC NULLS LAST`;

type PersonHistoryRow = Readonly<{
  person_id: string;
  person_name: string | null;
  id: string | null;
  kind: string | null;
  effective_on: string | null;
  effective_until: string | null;
  details: Record<string, unknown> | null;
  cursor_at: string | null;
}>;

async function hasAnyPeopleView(transaction: PoolClient, actorId: string, organisationId: string): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1 AND roles.organisation_id = $2
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL AND grants.permission_key = 'people.view'
     ) AS permitted`,
    [actorId, organisationId],
  );
  return result.rows[0]?.permitted === true;
}

export async function readPersonHistory(request: Request, personId: string): Promise<Response> {
  if (!uuidPattern.test(personId)) return json({ error: "PERSON_NOT_FOUND" }, 404);
  const page = parsePersonHistoryPage(request, personId);
  if (!page) return json({ error: "PERSON_HISTORY_QUERY_INVALID" }, 400);
  try { authenticationConfiguration(); } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);

  try {
    return await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasAnyPeopleView(transaction, actor.context.userId, actor.context.organisationId)) {
        return json({ error: "PERMISSION_DENIED" }, 403);
      }
      const result = await transaction.query<PersonHistoryRow>(personHistoryReadSql, [
        actor.context.organisationId,
        actor.context.userId,
        personId,
        page.cursorAt,
        page.cursorKind,
        page.cursorId,
        page.limit + 1,
      ]);
      const first = result.rows[0];
      if (!first) return json({ error: "PERSON_NOT_FOUND" }, 404);
      const historyRows = result.rows.filter((row) => row.id !== null && row.kind !== null);
      const hasMore = historyRows.length > page.limit;
      const entries = historyRows.slice(0, page.limit);
      const last = entries.at(-1);
      return json({
        person: { id: first.person_id, displayName: first.person_name },
        history: entries.map((row) => ({
          id: row.id,
          kind: row.kind,
          effectiveOn: row.effective_on,
          effectiveUntil: row.effective_until,
          details: row.details ?? {},
        })),
        limit: page.limit,
        hasMore,
        nextCursor: hasMore && last
          ? `${last.cursor_at}~${last.kind}~${last.id}~${personId.toLowerCase()}`
          : null,
      });
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
