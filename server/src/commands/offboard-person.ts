import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OffboardInput = Readonly<{
  personId: string;
  reason?: string;
  final: boolean;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function input(body: unknown): OffboardInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.personId !== "string" || !uuidPattern.test(candidate.personId)) {
    return undefined;
  }
  if (candidate.reason !== undefined &&
    (typeof candidate.reason !== "string" || !candidate.reason.trim() || candidate.reason.trim().length > 500)) {
    return undefined;
  }
  if (candidate.final !== undefined && typeof candidate.final !== "boolean") return undefined;
  return Object.freeze({
    personId: candidate.personId,
    ...(typeof candidate.reason === "string" ? { reason: candidate.reason.trim() } : {}),
    final: candidate.final === true,
  });
}

async function canOffboard(
  transaction: PoolClient,
  actorId: string,
  targetId: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments actor_roles
       JOIN nova.roles roles ON roles.id = actor_roles.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE actor_roles.person_id = $1
         AND actor_roles.effective_on <= nova.person_business_date($1)
         AND (actor_roles.effective_until IS NULL OR actor_roles.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL
         AND grants.permission_key = 'people.offboard'
         AND (
           grants.scope = 'organisation'
           OR (grants.scope = 'own_record' AND $1 = $2)
           OR (grants.scope = 'office' AND EXISTS (
             SELECT 1
             FROM nova.person_office_assignments target_offices
             WHERE target_offices.person_id = $2
               AND target_offices.office_id = grants.office_id
               AND target_offices.effective_on <= nova.person_business_date($2)
               AND (target_offices.effective_until IS NULL OR target_offices.effective_until >= nova.person_business_date($2))
           ))
           OR (grants.scope = 'organisation_department' AND EXISTS (
             SELECT 1
             FROM nova.person_department_assignments target_departments
             WHERE target_departments.person_id = $2
               AND target_departments.organisation_department_id = grants.organisation_department_id
               AND target_departments.effective_on <= nova.person_business_date($2)
               AND (target_departments.effective_until IS NULL OR target_departments.effective_until >= nova.person_business_date($2))
           ))
         )
     ) AS permitted`,
    [actorId, targetId],
  );
  return result.rows[0]?.permitted === true;
}

export async function offboardPerson(request: Request): Promise<Response> {
  try { authenticationConfiguration(); }
  catch { return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503); }

  const body = await request.json().catch(() => undefined);
  const value = input(body);
  if (!value) return json({ error: "PERSON_OFFBOARD_INPUT_INVALID" }, 400);

  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  if (value.personId === actor.context.userId) return json({ error: "PERSON_SELF_OFFBOARD_NOT_ALLOWED" }, 409);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await canOffboard(transaction, actor.context.userId, value.personId)) return "PERMISSION_DENIED" as const;
      const current = await transaction.query<{ status: string; effective_at: Date }>(
        `SELECT status, effective_at
         FROM nova.person_status_periods
         WHERE person_id = $1 AND ended_at IS NULL
         FOR UPDATE`,
        [value.personId],
      );
      const status = current.rows[0];
      if (!status) return "PERSON_NOT_FOUND" as const;
      if (status.status === "exited") return "PERSON_ALREADY_EXITED" as const;
      if (status.status === "offboarding" && !value.final) return "PERSON_ALREADY_OFFBOARDING" as const;
      const protectedTarget = await transaction.query<{ protected: boolean; actor_is_super_admin: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM nova.person_role_assignments assignments
           JOIN nova.roles roles ON roles.id = assignments.role_id
           WHERE assignments.person_id = $1
             AND assignments.effective_on <= nova.person_business_date($1)
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
             AND roles.key = 'super_admin' AND roles.is_protected AND roles.archived_at IS NULL
         ) AS protected,
         nova.request_actor_is_super_admin() AS actor_is_super_admin`,
        [value.personId],
      );
      if (protectedTarget.rows[0]?.protected && !protectedTarget.rows[0]?.actor_is_super_admin) {
        return "PERSON_PROTECTED_ROLE" as const;
      }
      const activeAssignments = await transaction.query<{ id: string }>(
        `SELECT assignments.id
         FROM nova.task_assignments assignments
         JOIN nova.tasks tasks ON tasks.id = assignments.task_id
         WHERE assignments.person_id = $1
           AND assignments.status NOT IN ('approved', 'cancelled')
           AND tasks.status <> 'cancelled'
         LIMIT 1`,
        [value.personId],
      );
      if (activeAssignments.rows[0]) return "ACTIVE_ASSIGNMENTS_REMAIN" as const;

      const transitionAt = new Date(Math.max(Date.now(), status.effective_at.getTime() + 1));
      const nextStatus = value.final ? "exited" : "offboarding";
      await transaction.query(
        `UPDATE nova.person_status_periods SET ended_at = $2
         WHERE person_id = $1 AND ended_at IS NULL`,
        [value.personId, transitionAt],
      );
      await transaction.query(
        `INSERT INTO nova.person_status_periods (person_id, status, effective_at, reason)
         VALUES ($1, $2::nova.person_status, $3, $4)`,
        [value.personId, nextStatus, transitionAt, value.reason ?? null],
      );
      const closedWork = await transaction.query<{ count: number }>(
        `SELECT nova.close_person_work_sessions($1, $2, 'OFFBOARDING') AS count`,
        [value.personId, transitionAt],
      );
      const closedAttendance = await transaction.query<{ count: number }>(
        `SELECT nova.close_person_attendance($1, $2) AS count`,
        [value.personId, transitionAt],
      );

      // End future operational assignments without rewriting their historical rows.
      await transaction.query(
        `UPDATE nova.person_office_assignments
         SET effective_until = CASE WHEN effective_on > nova.person_business_date($1) THEN effective_on ELSE nova.person_business_date($1) END
         WHERE person_id = $1 AND (effective_until IS NULL OR effective_until >= nova.person_business_date($1))`,
        [value.personId],
      );
      await transaction.query(
        `UPDATE nova.person_department_assignments
         SET effective_until = CASE WHEN effective_on > nova.person_business_date($1) THEN effective_on ELSE nova.person_business_date($1) END
         WHERE person_id = $1 AND (effective_until IS NULL OR effective_until >= nova.person_business_date($1))`,
        [value.personId],
      );
      await transaction.query(
        `UPDATE nova.person_role_assignments
         SET effective_until = CASE WHEN effective_on > nova.person_business_date($1) THEN effective_on ELSE nova.person_business_date($1) END
         WHERE person_id = $1 AND (effective_until IS NULL OR effective_until >= nova.person_business_date($1))`,
        [value.personId],
      );

      const sessions = await transaction.query<{ count: string }>(
        `WITH deleted AS (
          DELETE FROM nova_auth.session
          WHERE "userId" IN (
            SELECT subject FROM nova.person_identities
            WHERE person_id = $1 AND provider = 'better_auth' AND revoked_at IS NULL
          ) RETURNING id
        ) SELECT count(*)::text AS count FROM deleted`,
        [value.personId],
      );
      await transaction.query(
        `UPDATE nova.person_identities
         SET revoked_at = COALESCE(revoked_at, clock_timestamp())
         WHERE person_id = $1 AND provider = 'better_auth'`,
        [value.personId],
      );
      await transaction.query(
        `UPDATE nova.person_invitations
         SET revoked_at = COALESCE(revoked_at, clock_timestamp())
         WHERE person_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [value.personId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'people.offboard', 'person', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, value.personId,
          JSON.stringify({ status: nextStatus, revoked_session_count: Number(sessions.rows[0]?.count ?? 0), closed_work_session_count: Number(closedWork.rows[0]?.count ?? 0), closed_attendance_count: Number(closedAttendance.rows[0]?.count ?? 0), ...(value.reason ? { reason: value.reason } : {}) })],
      );
      const recipients = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_role_assignments assignments
         JOIN nova.roles roles ON roles.id = assignments.role_id
         JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
         WHERE assignments.person_id <> $1
           AND assignments.effective_on <= nova.person_business_date(assignments.person_id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))
           AND roles.archived_at IS NULL
           AND grants.permission_key = 'people.offboard'
           AND grants.scope = 'organisation'`,
        [value.personId],
      );
      for (const recipient of [value.personId, ...recipients.rows.map((row) => row.person_id)]) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: recipient,
          eventKey: "people.offboarding",
          title: nextStatus === "exited" ? "Account exited" : "Account offboarding started",
          body: recipient === value.personId
            ? nextStatus === "exited"
              ? "Your NOVA account has been closed. Contact an administrator if this is unexpected."
              : "Your NOVA offboarding process has started."
            : nextStatus === "exited"
              ? "A team member's NOVA account was closed."
              : "A team member's NOVA offboarding process has started.",
          aggregateType: "person",
          aggregateId: value.personId,
          deepLink: recipient === value.personId ? "/?view=home" : "/?view=admin",
          idempotencyKey: `people.offboarding:${value.personId}:${transitionAt.toISOString()}:${recipient}`,
        });
      }
      return nextStatus as "offboarding" | "exited";
    });

    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "PERSON_NOT_FOUND") return json({ error: result }, 404);
    if (result === "PERSON_ALREADY_EXITED" || result === "PERSON_ALREADY_OFFBOARDING" || result === "ACTIVE_ASSIGNMENTS_REMAIN" || result === "PERSON_PROTECTED_ROLE") return json({ error: result }, 409);
    return json({ offboarded: true, status: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
