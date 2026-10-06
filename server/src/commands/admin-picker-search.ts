import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const resultLimit = 50;

export type AdminOnboardingPickerKind = "office" | "department" | "role" | "manager";

export type AdminPickerSearch = Readonly<{
  query: string;
  pattern: string | null;
}>;

export type AdminOnboardingPickerSearch = AdminPickerSearch & Readonly<{
  kind: AdminOnboardingPickerKind;
  personId: string | null;
}>;

function escapeLike(query: string): string {
  return query.replace(/[\\^%_]/g, "^$&");
}

function parseSearchParams(params: URLSearchParams): AdminPickerSearch | undefined {
  const raw = params.getAll("q");
  if (raw.length > 1) return undefined;
  const query = (raw[0] ?? "").normalize("NFC").trim();
  if (query.length > 100 || query.includes("\u0000")) return undefined;
  return { query, pattern: query ? `%${escapeLike(query)}%` : null };
}

function hasOnlyParams(params: URLSearchParams, allowed: readonly string[]): boolean {
  return [...params.keys()].every((key) => allowed.includes(key));
}

export function parseAdminOnboardingPickerSearch(request: Request): AdminOnboardingPickerSearch | undefined {
  const params = new URL(request.url).searchParams;
  if (!hasOnlyParams(params, ["kind", "q", "personId"])) return undefined;
  const kinds = params.getAll("kind");
  const personIds = params.getAll("personId");
  if (kinds.length !== 1 || personIds.length > 1) return undefined;
  const kind = kinds[0];
  if (!(["office", "department", "role", "manager"] as const).includes(kind as AdminOnboardingPickerKind)) return undefined;
  const rawPersonId = personIds[0] ?? null;
  if (kind === "manager") {
    if (!rawPersonId || !uuidPattern.test(rawPersonId)) return undefined;
  } else if (rawPersonId !== null) {
    return undefined;
  }
  const search = parseSearchParams(params);
  if (!search) return undefined;
  return { ...search, kind: kind as AdminOnboardingPickerKind, personId: rawPersonId };
}

export function parseEligibleOwnerSearch(request: Request): AdminPickerSearch | undefined {
  const params = new URL(request.url).searchParams;
  if (!hasOnlyParams(params, ["q"])) return undefined;
  return parseSearchParams(params);
}

export const organisationPermissionSql = `SELECT EXISTS (
  SELECT 1
  FROM nova.person_role_assignments assignments
  JOIN nova.roles roles ON roles.id = assignments.role_id
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE assignments.person_id = $1
    AND assignments.effective_on <= nova.person_business_date($1)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
    AND roles.archived_at IS NULL
    AND grants.permission_key = $2
    AND grants.scope = 'organisation'
) AS permitted`;

export const ownerTransferPermissionSql = `SELECT
  nova.request_actor_is_super_admin() AS is_super_admin,
  EXISTS (
    SELECT 1
    FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
    WHERE assignments.person_id = $1
      AND assignments.effective_on <= nova.person_business_date($1)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
      AND roles.archived_at IS NULL
      AND grants.permission_key = 'people.view'
      AND grants.scope = 'organisation'
  ) AS can_view_people`;

export const eligibleOwnerTransferPeopleSql = `SELECT people.id,
  COALESCE(NULLIF(btrim(people.display_name), ''), people.email) AS label
FROM nova.people people
JOIN LATERAL (
  SELECT periods.status
  FROM nova.person_status_periods periods
  WHERE periods.person_id = people.id AND periods.ended_at IS NULL
  ORDER BY periods.effective_at DESC
  LIMIT 1
) status_period ON status_period.status IN ('active', 'notice')
WHERE people.organisation_id = $1
  AND people.id <> $2
  AND ($3::text IS NULL OR CONCAT_WS(' ', people.display_name, people.email) ILIKE $3 ESCAPE '^')
  AND NOT EXISTS (
    SELECT 1
    FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    WHERE assignments.person_id = people.id
      AND roles.organisation_id = people.organisation_id
      AND roles.key = 'super_admin'
      AND roles.is_protected
      AND roles.archived_at IS NULL
      AND assignments.effective_on <= nova.person_business_date(people.id)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
  )
ORDER BY lower(COALESCE(NULLIF(btrim(people.display_name), ''), people.email)), people.id
LIMIT $4`;

async function withOperationalActor(
  request: Request,
  operation: (transaction: PoolClient, organisationId: string, actorId: string) => Promise<unknown | Response>,
  unauthorized = "PERMISSION_DENIED",
): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);

  try {
    const result = await withDatabaseRequest(actor.context, (transaction) =>
      operation(transaction, actor.context.organisationId, actor.context.userId));
    if (result instanceof Response) return result;
    if (result === undefined) return json({ error: unauthorized }, 403);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

async function hasOrganisationPermission(
  transaction: PoolClient,
  actorId: string,
  permission: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(organisationPermissionSql, [actorId, permission]);
  return result.rows[0]?.permitted === true;
}

export async function searchAdminOnboardingOptions(request: Request): Promise<Response> {
  const filters = parseAdminOnboardingPickerSearch(request);
  if (!filters) return json({ error: "ADMIN_PICKER_QUERY_INVALID" }, 400);

  const permission = filters.kind === "role" ? "roles.view" :
    filters.kind === "manager" ? "people.view" : "organisation.settings.manage";

  return withOperationalActor(request, async (transaction, organisationId, actorId) => {
    if (!await hasOrganisationPermission(transaction, actorId, permission)) return undefined;
    const params = [organisationId, filters.pattern, resultLimit];

    if (filters.kind === "office") {
      const result = await transaction.query<{ id: string; name: string; timezone: string }>(
        `SELECT id, name, timezone FROM nova.offices
         WHERE organisation_id = $1 AND archived_at IS NULL
           AND ($2::text IS NULL OR name ILIKE $2 ESCAPE '^')
         ORDER BY lower(name), id LIMIT $3`,
        params,
      );
      return { options: result.rows.map(({ id, name, timezone }) => ({ id, name, timezone })) };
    }

    if (filters.kind === "department") {
      const result = await transaction.query<{ id: string; name: string }>(
        `SELECT id, name FROM nova.organisation_departments
         WHERE organisation_id = $1 AND archived_at IS NULL
           AND ($2::text IS NULL OR name ILIKE $2 ESCAPE '^')
         ORDER BY lower(name), id LIMIT $3`,
        params,
      );
      return { options: result.rows };
    }

    if (filters.kind === "role") {
      const result = await transaction.query<{ id: string; name: string }>(
        `SELECT id, name FROM nova.roles
         WHERE organisation_id = $1 AND archived_at IS NULL AND NOT is_protected
           AND ($2::text IS NULL OR (name ILIKE $2 ESCAPE '^' OR key ILIKE $2 ESCAPE '^'))
         ORDER BY lower(name), id LIMIT $3`,
        params,
      );
      return { options: result.rows };
    }

    const result = await transaction.query<{ id: string; name: string | null; email: string }>(
      `SELECT people.id, people.display_name AS name, people.email
       FROM nova.people people
       JOIN LATERAL (
         SELECT periods.status
         FROM nova.person_status_periods periods
         WHERE periods.person_id = people.id AND periods.ended_at IS NULL
         ORDER BY periods.effective_at DESC
         LIMIT 1
       ) status_period ON status_period.status IN ('active', 'notice')
       WHERE people.organisation_id = $1 AND people.id <> $4
         AND ($2::text IS NULL OR CONCAT_WS(' ', people.display_name, people.email) ILIKE $2 ESCAPE '^')
       ORDER BY lower(COALESCE(NULLIF(btrim(people.display_name), ''), people.email)), people.id
       LIMIT $3`,
      [organisationId, filters.pattern, resultLimit, filters.personId],
    );
    return { options: result.rows.map((person) => ({
      id: person.id,
      name: person.name?.trim() || person.email,
    })) };
  });
}

export async function searchEligibleOwnerTransferPeople(request: Request): Promise<Response> {
  const filters = parseEligibleOwnerSearch(request);
  if (!filters) return json({ error: "OWNER_TRANSFER_SEARCH_INVALID" }, 400);

  return withOperationalActor(request, async (transaction, organisationId, actorId) => {
    const permission = await transaction.query<{ is_super_admin: boolean; can_view_people: boolean }>(
      ownerTransferPermissionSql,
      [actorId],
    );
    if (permission.rows[0]?.is_super_admin !== true || permission.rows[0]?.can_view_people !== true) {
      return undefined;
    }
    const result = await transaction.query<{ id: string; label: string }>(eligibleOwnerTransferPeopleSql, [
      organisationId,
      actorId,
      filters.pattern,
      resultLimit,
    ]);
    return { people: result.rows };
  }, "PERMISSION_DENIED");
}
