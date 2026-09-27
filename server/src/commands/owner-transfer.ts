import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function transferSuperAdmin(request: Request): Promise<Response> {
  try { authenticationConfiguration(); }
  catch { return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503); }
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  const body = await request.json().catch(() => ({}));
  const value = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const targetPersonId = typeof value.targetPersonId === "string" ? value.targetPersonId : undefined;
  if (!targetPersonId || !uuidPattern.test(targetPersonId) || value.confirmation !== "TRANSFER SUPER ADMIN") {
    return json({ error: "OWNER_TRANSFER_INPUT_INVALID" }, 400);
  }
  if (targetPersonId === actor.context.userId) return json({ error: "OWNER_TRANSFER_TARGET_INVALID" }, 409);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const owner = await transaction.query<{ permitted: boolean }>("SELECT nova.request_actor_is_super_admin() AS permitted");
      if (owner.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      const target = await transaction.query<{ id: string; status: string }>(
        `SELECT people.id, status_periods.status
         FROM nova.people people
         JOIN nova.person_status_periods status_periods
           ON status_periods.person_id = people.id AND status_periods.ended_at IS NULL
         WHERE people.id = $1 AND people.organisation_id = $2 FOR UPDATE`,
        [targetPersonId, actor.context.organisationId],
      );
      if (!target.rows[0]) return "TARGET_NOT_FOUND" as const;
      if (!(target.rows[0].status === "active" || target.rows[0].status === "notice")) return "TARGET_NOT_OPERATIONAL" as const;
      const role = await transaction.query<{ id: string }>(
        `SELECT id FROM nova.roles
         WHERE organisation_id = $1 AND key = 'super_admin' AND is_protected AND archived_at IS NULL FOR UPDATE`,
        [actor.context.organisationId],
      );
      const roleId = role.rows[0]?.id;
      if (!roleId) throw new Error("SUPER_ADMIN_ROLE_MISSING");
      const already = await transaction.query(
        `SELECT 1 FROM nova.person_role_assignments
         WHERE person_id = $1 AND role_id = $2 AND effective_on <= nova.person_business_date($1)
           AND (effective_until IS NULL OR effective_until >= nova.person_business_date($1))`,
        [targetPersonId, roleId],
      );
      if (already.rows[0]) return "TARGET_ALREADY_OWNER" as const;
      await transaction.query(
        `INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
         VALUES ($1, $2, nova.person_business_date($1))`,
        [targetPersonId, roleId],
      );
      await transaction.query(
        `UPDATE nova.person_role_assignments
         SET effective_until = CASE WHEN effective_on > nova.person_business_date($1) THEN effective_on ELSE nova.person_business_date($1) END
         WHERE person_id = $1 AND role_id = $2 AND effective_until IS NULL`,
        [actor.context.userId, roleId],
      );
      const revoked = await transaction.query<{ count: string }>(
        `WITH deleted AS (
          DELETE FROM nova_auth.session
          WHERE "userId" IN (
            SELECT subject FROM nova.person_identities
            WHERE person_id = $1 AND provider = 'better_auth' AND revoked_at IS NULL
          ) RETURNING id
        ) SELECT count(*)::text AS count FROM deleted`,
        [actor.context.userId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'organisation.owner_transferred', 'person', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, targetPersonId,
          JSON.stringify({ previous_owner_id: actor.context.userId, revoked_session_count: Number(revoked.rows[0]?.count ?? 0) })],
      );
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId,
        recipientPersonId: targetPersonId,
        eventKey: "people.owner_transferred",
        title: "You are now the Super Admin",
        body: "The organisation owner role has been transferred to you.",
        aggregateType: "person",
        aggregateId: targetPersonId,
        deepLink: "/?view=admin",
        idempotencyKey: `people.owner_transferred:${targetPersonId}:${actor.context.userId}`,
      });
      return targetPersonId;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "TARGET_NOT_FOUND") return json({ error: result }, 404);
    if (result === "TARGET_NOT_OPERATIONAL" || result === "TARGET_ALREADY_OWNER") return json({ error: result }, 409);
    return json({ transferred: true, targetPersonId: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
