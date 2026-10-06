import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumQueryLength = 100;
const maximumResults = 30;

export type ClientMembershipOptionKind = "person" | "department";
export type ClientMembershipOptionSearch = Readonly<{
  kind: ClientMembershipOptionKind;
  query: string;
  limit: number;
}>;

export function parseClientMembershipOptionSearch(request: Request): ClientMembershipOptionSearch | undefined {
  const params = new URL(request.url).searchParams;
  const kinds = params.getAll("kind");
  const queries = params.getAll("q");
  if (kinds.length !== 1 || queries.length > 1) return undefined;
  const kind = kinds[0];
  if (kind !== "person" && kind !== "department") return undefined;
  const query = (queries[0] ?? "").normalize("NFC").trim().toLowerCase();
  if (query.length > maximumQueryLength || query.includes("\u0000")) return undefined;
  return { kind, query, limit: maximumResults };
}

/** Existing membership controls expose the people selector only for organisation-level people.view. */
export const membershipPeopleViewPermissionSql = `SELECT EXISTS (
  SELECT 1 FROM nova.person_role_assignments assignments
  JOIN nova.roles roles ON roles.id = assignments.role_id
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE assignments.person_id = $1 AND roles.organisation_id = $2
    AND assignments.effective_on <= nova.person_business_date($1)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
    AND roles.archived_at IS NULL
    AND grants.permission_key = 'people.view' AND grants.scope = 'organisation'
) AS permitted`;

export const membershipOptionsAccessSql = `SELECT
  EXISTS (
    SELECT 1 FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
    WHERE assignments.person_id = $1 AND roles.organisation_id = $3
      AND assignments.effective_on <= nova.person_business_date($1)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
      AND roles.archived_at IS NULL AND grants.permission_key = 'clients.members.manage'
      AND (grants.scope = 'organisation' OR (grants.scope = 'client' AND grants.client_id = $2))
  ) AS can_manage_memberships,
  EXISTS (
    SELECT 1 FROM nova.clients
    WHERE id = $2 AND organisation_id = $3 AND archived_at IS NULL
  ) AS client_exists,
  EXISTS (
    SELECT 1 FROM nova.person_role_assignments assignments
    JOIN nova.roles roles ON roles.id = assignments.role_id
    JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
    WHERE assignments.person_id = $1 AND roles.organisation_id = $3
      AND assignments.effective_on <= nova.person_business_date($1)
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
      AND roles.archived_at IS NULL
      AND grants.permission_key = 'people.view' AND grants.scope = 'organisation'
  ) AS can_view_people`;

export const membershipPeopleOptionSql = `SELECT people.id,
       COALESCE(NULLIF(BTRIM(people.display_name), ''), NULLIF(BTRIM(people.email), ''), 'Unnamed person') AS label
FROM nova.people people
WHERE people.organisation_id = $1
  AND ($2 = '' OR position($2 in lower(COALESCE(people.display_name, '') || ' ' || people.email)) > 0)
ORDER BY lower(COALESCE(NULLIF(BTRIM(people.display_name), ''), people.email)), people.id
LIMIT $3`;

export const membershipDepartmentOptionSql = `SELECT departments.id, departments.name
FROM nova.client_departments departments
WHERE departments.client_id = $1 AND departments.organisation_id = $2
  AND departments.archived_at IS NULL
  AND ($3 = '' OR position($3 in lower(departments.name)) > 0)
ORDER BY departments.name, departments.id
LIMIT $4`;

export async function readClientMembershipOptions(request: Request, clientId: string): Promise<Response> {
  const filters = parseClientMembershipOptionSearch(request);
  if (!filters) return json({ error: "CLIENT_MEMBERSHIP_OPTIONS_QUERY_INVALID" }, 400);
  if (!uuidPattern.test(clientId)) return json({ error: "CLIENT_NOT_FOUND" }, 404);
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction: PoolClient) => {
      const access = await transaction.query<{
        can_manage_memberships: boolean;
        client_exists: boolean;
        can_view_people: boolean;
      }>(
        membershipOptionsAccessSql,
        [actor.context.userId, clientId, actor.context.organisationId],
      );
      const grants = access.rows[0];
      if (grants?.can_manage_memberships !== true) return "PERMISSION_DENIED" as const;
      if (grants.client_exists !== true) return "CLIENT_NOT_FOUND" as const;

      if (filters.kind === "department") {
        const rows = await transaction.query<{ id: string; name: string }>(membershipDepartmentOptionSql, [
          clientId, actor.context.organisationId, filters.query, filters.limit,
        ]);
        return { options: rows.rows.map(({ id, name }) => ({ id, label: name })) };
      }

      if (grants.can_view_people !== true) return "PEOPLE_PERMISSION_DENIED" as const;
      const rows = await transaction.query<{ id: string; label: string }>(membershipPeopleOptionSql, [
        actor.context.organisationId, filters.query, filters.limit,
      ]);
      return { options: rows.rows.map(({ id, label }) => ({ id, label })) };
    });
    if (result === "PERMISSION_DENIED" || result === "PEOPLE_PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    if (result === "CLIENT_NOT_FOUND") return json({ error: result }, 404);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
