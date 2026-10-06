import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const membershipCursorUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validClientAccessDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

export function validClientMembershipEndDate(value: unknown, effectiveOn: string, today: string): value is string {
  return validClientAccessDate(value) && validClientAccessDate(effectiveOn) && validClientAccessDate(today) &&
    value >= effectiveOn && value >= today;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function normalActor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); } catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => ({}));
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export const clientAccessManagePermissionSql = `SELECT EXISTS (
       SELECT 1 FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1 AND roles.organisation_id = $4
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL AND grants.permission_key = $2
         AND (grants.scope = 'organisation' OR (grants.scope = 'client' AND grants.client_id = $3))
     ) AS permitted`;

async function canManage(
  transaction: PoolClient,
  actorId: string,
  permission: string,
  clientId: string,
  organisationId: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    clientAccessManagePermissionSql,
    [actorId, permission, clientId, organisationId],
  );
  return result.rows[0]?.permitted === true;
}

export type ClientMembershipPage = Readonly<{
  limit: number;
  cursorDate: string | null;
  cursorId: string | null;
}>;

export function parseClientMembershipPage(request: Request, clientId: string): ClientMembershipPage | undefined {
  if (!membershipCursorUuidPattern.test(clientId)) return undefined;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return undefined;
  const rawCursor = params.get("cursor");
  if (!rawCursor) return { limit, cursorDate: null, cursorId: null };
  const [cursorDate, cursorId, cursorClientId, ...extra] = rawCursor.split("~");
  if (extra.length || !cursorDate || !cursorId || !cursorClientId || !validClientAccessDate(cursorDate) ||
      !membershipCursorUuidPattern.test(cursorId) || !membershipCursorUuidPattern.test(cursorClientId) ||
      cursorClientId.toLowerCase() !== clientId.toLowerCase()) return undefined;
  return { limit, cursorDate, cursorId };
}

export const clientMembershipReadSql = `SELECT memberships.id, memberships.person_id,
       people.display_name AS person_name,
       memberships.client_department_id, departments.name AS client_department_name,
       memberships.membership_label, memberships.effective_on::text, memberships.effective_until::text
FROM nova.client_memberships memberships
JOIN nova.clients clients
  ON clients.id = memberships.client_id AND clients.organisation_id = memberships.organisation_id
JOIN nova.people ON people.id = memberships.person_id AND people.organisation_id = memberships.organisation_id
LEFT JOIN nova.client_departments departments
  ON departments.id = memberships.client_department_id AND departments.client_id = memberships.client_id
WHERE memberships.client_id = $1 AND memberships.organisation_id = $2
  AND ($3::date IS NULL OR (memberships.effective_on, memberships.id) < ($3::date, $4::uuid))
ORDER BY memberships.effective_on DESC, memberships.id DESC
LIMIT $5`;

type ClientMembershipReadRow = Readonly<{
  id: string;
  person_id: string;
  person_name: string | null;
  client_department_id: string | null;
  client_department_name: string | null;
  membership_label: string | null;
  effective_on: string;
  effective_until: string | null;
}>;

export async function readClientMemberships(request: Request, clientId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!membershipCursorUuidPattern.test(clientId)) return json({ error: "CLIENT_NOT_FOUND" }, 404);
  const page = parseClientMembershipPage(request, clientId);
  if (!page) return json({ error: "CLIENT_MEMBERSHIP_QUERY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await canManage(transaction, actor.context.userId, "clients.members.manage", clientId, actor.context.organisationId)) {
        return "PERMISSION_DENIED" as const;
      }
      const client = await transaction.query(
        `SELECT 1 FROM nova.clients WHERE id = $1 AND organisation_id = $2`,
        [clientId, actor.context.organisationId],
      );
      if (!client.rows[0]) return "CLIENT_NOT_FOUND" as const;
      const rows = await transaction.query<ClientMembershipReadRow>(clientMembershipReadSql, [
        clientId,
        actor.context.organisationId,
        page.cursorDate,
        page.cursorId,
        page.limit + 1,
      ]);
      const hasMore = rows.rows.length > page.limit;
      const memberships = rows.rows.slice(0, page.limit);
      const last = memberships.at(-1);
      return {
        memberships: memberships.map((membership) => ({
          id: membership.id,
          person: { id: membership.person_id, displayName: membership.person_name },
          clientDepartment: membership.client_department_id
            ? { id: membership.client_department_id, name: membership.client_department_name }
            : null,
          membershipLabel: membership.membership_label,
          effectiveOn: membership.effective_on,
          effectiveUntil: membership.effective_until,
        })),
        limit: page.limit,
        hasMore,
        nextCursor: hasMore && last
          ? `${last.effective_on}~${last.id}~${clientId.toLowerCase()}`
          : null,
      };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "CLIENT_NOT_FOUND") return json({ error: result }, 404);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createClientDepartment(request: Request, clientId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(clientId)) return json({ error: "CLIENT_NOT_FOUND" }, 404);
  const value = await body(request);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 180) return json({ error: "CLIENT_DEPARTMENT_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const client = await transaction.query("SELECT 1 FROM nova.clients WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL", [clientId, actor.context.organisationId]);
      if (!client.rows[0]) return "CLIENT_NOT_FOUND" as const;
      if (!await canManage(transaction, actor.context.userId, "clients.departments.manage", clientId, actor.context.organisationId)) return "PERMISSION_DENIED" as const;
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.client_departments (organisation_id, client_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [actor.context.organisationId, clientId, name],
      );
      return created.rows[0]?.id ?? (() => { throw new Error("CLIENT_DEPARTMENT_CREATE_RESULT_MISSING"); })();
    });
    if (result === "CLIENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ clientDepartmentId: result }, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "CLIENT_DEPARTMENT_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createClientMembership(request: Request, clientId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(clientId)) return json({ error: "CLIENT_NOT_FOUND" }, 404);
  const value = await body(request);
  const personId = typeof value.personId === "string" && uuidPattern.test(value.personId) ? value.personId : undefined;
  const departmentId = value.clientDepartmentId === undefined || value.clientDepartmentId === null ? null : (typeof value.clientDepartmentId === "string" && uuidPattern.test(value.clientDepartmentId) ? value.clientDepartmentId : undefined);
  const effectiveOn = value.effectiveOn === undefined ? new Date().toISOString().slice(0, 10) : value.effectiveOn;
  const effectiveUntil = value.effectiveUntil === undefined || value.effectiveUntil === null ? null : value.effectiveUntil;
  const label = value.membershipLabel === undefined || value.membershipLabel === null ? null : (typeof value.membershipLabel === "string" ? value.membershipLabel.trim() : undefined);
  if (!personId || departmentId === undefined || !validClientAccessDate(effectiveOn) ||
    (effectiveUntil !== null && (!validClientAccessDate(effectiveUntil) || effectiveUntil < effectiveOn)) ||
    label === undefined || (label !== null && (!label || label.length > 120))) {
    return json({ error: "CLIENT_MEMBERSHIP_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await canManage(transaction, actor.context.userId, "clients.members.manage", clientId, actor.context.organisationId)) return "PERMISSION_DENIED" as const;
      const person = await transaction.query("SELECT 1 FROM nova.people WHERE id = $1 AND organisation_id = $2", [personId, actor.context.organisationId]);
      if (!person.rows[0]) return "PERSON_NOT_FOUND" as const;
      if (departmentId) {
        const department = await transaction.query("SELECT 1 FROM nova.client_departments WHERE id = $1 AND client_id = $2 AND organisation_id = $3 AND archived_at IS NULL", [departmentId, clientId, actor.context.organisationId]);
        if (!department.rows[0]) return "CLIENT_DEPARTMENT_NOT_FOUND" as const;
      }
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.client_memberships (organisation_id, client_id, person_id, client_department_id, membership_label, effective_on, effective_until)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date) RETURNING id`,
        [actor.context.organisationId, clientId, personId, departmentId, label, effectiveOn, effectiveUntil],
      );
      return created.rows[0]?.id ?? (() => { throw new Error("CLIENT_MEMBERSHIP_CREATE_RESULT_MISSING"); })();
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "PERSON_NOT_FOUND" || result === "CLIENT_DEPARTMENT_NOT_FOUND") return json({ error: result }, 404);
    return json({ clientMembershipId: result }, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "CLIENT_MEMBERSHIP_ALREADY_EXISTS" }, 409);
    if (error instanceof Error && /CLIENT_ACCESS_ORGANISATION|CLIENT_DEPARTMENT_MISMATCH/i.test(error.message)) return json({ error: "CLIENT_MEMBERSHIP_INPUT_INVALID" }, 400);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function endClientMembership(request: Request, clientId: string, membershipId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(clientId) || !uuidPattern.test(membershipId)) return json({ error: "CLIENT_MEMBERSHIP_NOT_FOUND" }, 404);
  const value = await body(request);
  const effectiveUntil = value.effectiveUntil;
  if (!validClientAccessDate(effectiveUntil)) return json({ error: "CLIENT_MEMBERSHIP_END_DATE_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await canManage(transaction, actor.context.userId, "clients.members.manage", clientId, actor.context.organisationId)) {
        return "PERMISSION_DENIED" as const;
      }
      const membership = await transaction.query<{
        person_id: string;
        effective_on: string;
        effective_until: string | null;
      }>(
        `SELECT memberships.person_id, memberships.effective_on::text, memberships.effective_until::text
         FROM nova.client_memberships memberships
         JOIN nova.clients clients
           ON clients.id = memberships.client_id AND clients.organisation_id = memberships.organisation_id
         WHERE memberships.id = $1 AND memberships.client_id = $2 AND memberships.organisation_id = $3
         FOR UPDATE OF memberships`,
        [membershipId, clientId, actor.context.organisationId],
      );
      const current = membership.rows[0];
      if (!current) return "CLIENT_MEMBERSHIP_NOT_FOUND" as const;
      const date = await transaction.query<{ today: string }>(
        `SELECT nova.person_business_date($1)::text AS today`,
        [actor.context.userId],
      );
      const today = date.rows[0]?.today;
      if (!today) throw new Error("PERSON_BUSINESS_DATE_MISSING");
      if (current.effective_until !== null) {
        return "CLIENT_MEMBERSHIP_END_ALREADY_SET" as const;
      }
      if (!validClientMembershipEndDate(effectiveUntil, current.effective_on, today)) {
        return "CLIENT_MEMBERSHIP_END_DATE_INVALID" as const;
      }
      await transaction.query(
        `UPDATE nova.client_memberships
         SET effective_until = $3::date
         WHERE id = $1 AND client_id = $2 AND organisation_id = $4 AND effective_until IS NULL`,
        [membershipId, clientId, effectiveUntil, actor.context.organisationId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'clients.membership.ended', 'client_membership', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, membershipId, JSON.stringify({
          client_id: clientId,
          person_id: current.person_id,
          effective_on: current.effective_on,
          effective_until: effectiveUntil,
        })],
      );
      return { clientMembershipId: membershipId, effectiveUntil };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "CLIENT_MEMBERSHIP_NOT_FOUND") return json({ error: result }, 404);
    if (result === "CLIENT_MEMBERSHIP_END_ALREADY_SET") return json({ error: result }, 409);
    if (result === "CLIENT_MEMBERSHIP_END_DATE_INVALID") return json({ error: result }, 400);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
