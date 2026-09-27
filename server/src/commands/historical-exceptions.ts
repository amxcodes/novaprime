import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function hasOrganisationPermission(
  transaction: PoolClient,
  actorId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
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
     ) AS permitted`,
    [actorId, permissionKey],
  );
  return result.rows[0]?.permitted === true;
}

export async function readHistoricalExceptions(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.exception.view")) {
        return "PERMISSION_DENIED" as const;
      }
      const rows = await transaction.query<{
        id: string; source_type: string; source_id: string; person_id: string | null;
        business_date: string | null; code: string; status: string; details: unknown;
        opened_at: Date; resolution_note: string | null;
      }>(
        `SELECT id, source_type, source_id, person_id, business_date, code, status,
                details, opened_at, resolution_note
         FROM nova.historical_exceptions
         WHERE organisation_id = $1
         ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, opened_at DESC
         LIMIT 100`,
        [actor.context.organisationId],
      );
      return rows.rows.map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        personId: row.person_id,
        businessDate: row.business_date,
        code: row.code,
        status: row.status,
        details: row.details,
        openedAt: row.opened_at,
        resolutionNote: row.resolution_note,
      }));
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ exceptions: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function resolveHistoricalException(request: Request, exceptionId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(exceptionId)) return json({ error: "HISTORICAL_EXCEPTION_NOT_FOUND" }, 404);
  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const candidate = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const status = candidate.status;
  const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
  if (status !== "resolved" && status !== "dismissed" || !note || note.length > 2000) {
    return json({ error: "HISTORICAL_EXCEPTION_RESOLUTION_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.exception.resolve")) {
        return "PERMISSION_DENIED" as const;
      }
      const existing = await transaction.query<{ code: string }>(
        `SELECT code
         FROM nova.historical_exceptions
         WHERE id = $1 AND organisation_id = $2 AND status = 'open'
         FOR UPDATE`,
        [exceptionId, actor.context.organisationId],
      );
      if (existing.rows[0]?.code === "availability.leave_attendance_conflict") {
        return "LEAVE_CONFLICT_REQUIRES_DECISION" as const;
      }
      const updated = await transaction.query<{ id: string; status: string }>(
        `UPDATE nova.historical_exceptions
         SET status = $2::nova.historical_exception_status,
             resolved_by_person_id = $3,
             resolved_at = clock_timestamp(),
             resolution_note = $4
         WHERE id = $1 AND organisation_id = $5 AND status = 'open'
         RETURNING id, status`,
        [exceptionId, status, actor.context.userId, note, actor.context.organisationId],
      );
      if (!updated.rows[0]) return "HISTORICAL_EXCEPTION_NOT_OPEN" as const;
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.exception.resolved', 'historical_exception', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, exceptionId, JSON.stringify({ status, note })],
      );
      return { exceptionId, status };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "LEAVE_CONFLICT_REQUIRES_DECISION") return json({ error: result }, 409);
    if (result === "HISTORICAL_EXCEPTION_NOT_OPEN") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
