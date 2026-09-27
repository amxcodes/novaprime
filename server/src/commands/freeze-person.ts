import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";

type FreezePersonInput = Readonly<{ personId: string; reason?: string }>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function freezePersonInput(body: unknown): FreezePersonInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.personId !== "string" ||
    !uuidPattern.test(candidate.personId) ||
    (candidate.reason !== undefined &&
      (typeof candidate.reason !== "string" || !candidate.reason.trim()))
  ) {
    return undefined;
  }

  return Object.freeze({
    personId: candidate.personId,
    ...(typeof candidate.reason === "string" ? { reason: candidate.reason.trim() } : {}),
  });
}

async function canFreeze(transaction: PoolClient, actorId: string): Promise<boolean> {
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
        AND grants.permission_key = 'people.freeze'
        AND grants.scope = 'organisation'
    ) AS permitted`,
    [actorId],
  );
  return result.rows[0]?.permitted === true;
}

export async function freezePerson(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "PERSON_FREEZE_INPUT_INVALID" }, 400);
  }
  const input = freezePersonInput(body);
  if (!input) {
    return json({ error: "PERSON_FREEZE_INPUT_INVALID" }, 400);
  }

  const actor = await requestActor(request);
  if (!actor) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }
  if (!isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }
  if (input.personId === actor.context.userId) {
    return json({ error: "PERSON_SELF_FREEZE_NOT_ALLOWED" }, 409);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await canFreeze(transaction, actor.context.userId)) {
        return "PERMISSION_DENIED" as const;
      }

      const current = await transaction.query<{
        effective_at: Date;
        status: string;
      }>(
        `SELECT status, effective_at
         FROM nova.person_status_periods
         WHERE person_id = $1 AND ended_at IS NULL
         FOR UPDATE`,
        [input.personId],
      );
      const status = current.rows[0];
      if (!status) {
        return "PERSON_NOT_FOUND" as const;
      }
      if (status.status === "frozen") {
        return "PERSON_ALREADY_FROZEN" as const;
      }
      if (status.status === "exited") {
        return "PERSON_NOT_FREEZABLE" as const;
      }
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
        [input.personId],
      );
      if (protectedTarget.rows[0]?.protected && !protectedTarget.rows[0]?.actor_is_super_admin) {
        return "PERSON_PROTECTED_ROLE" as const;
      }

      const transitionAt = new Date(
        Math.max(Date.now(), status.effective_at.getTime() + 1),
      );
      await transaction.query(
        `UPDATE nova.person_status_periods
         SET ended_at = $2
         WHERE person_id = $1 AND ended_at IS NULL`,
        [input.personId, transitionAt],
      );
      await transaction.query(
        `INSERT INTO nova.person_status_periods (person_id, status, effective_at, reason)
         VALUES ($1, 'frozen', $2, $3)`,
        [input.personId, transitionAt, input.reason ?? null],
      );
      const closedWork = await transaction.query<{ count: number }>(
        `SELECT nova.close_person_work_sessions($1, $2, 'ACCOUNT_FROZEN') AS count`,
        [input.personId, transitionAt],
      );
      const closedAttendance = await transaction.query<{ count: number }>(
        `SELECT nova.close_person_attendance($1, $2) AS count`,
        [input.personId, transitionAt],
      );
      const sessions = await transaction.query<{ count: string }>(
        `WITH deleted AS (
          DELETE FROM nova_auth.session
          WHERE "userId" IN (
            SELECT subject
            FROM nova.person_identities
            WHERE person_id = $1
              AND provider = 'better_auth'
              AND revoked_at IS NULL
          )
          RETURNING id
        )
        SELECT count(*)::text AS count FROM deleted`,
        [input.personId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'people.freeze', 'person', $3, $4)`,
        [
          actor.context.organisationId,
          actor.context.userId,
          input.personId,
          JSON.stringify({
            revoked_session_count: Number(sessions.rows[0]?.count ?? 0),
            closed_work_session_count: Number(closedWork.rows[0]?.count ?? 0),
            closed_attendance_count: Number(closedAttendance.rows[0]?.count ?? 0),
            ...(input.reason ? { reason: input.reason } : {}),
          }),
        ],
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
           AND grants.permission_key = 'people.freeze'
           AND grants.scope = 'organisation'`,
        [input.personId],
      );
      for (const recipient of [input.personId, ...recipients.rows.map((row) => row.person_id)]) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: recipient,
          eventKey: "people.frozen",
          title: "Account frozen",
          body: recipient === input.personId
            ? "Your NOVA account has been frozen. Contact an administrator if this is unexpected."
            : "A team member's NOVA account was frozen.",
          aggregateType: "person",
          aggregateId: input.personId,
          deepLink: recipient === input.personId ? "/?view=home" : "/?view=admin",
          idempotencyKey: `people.frozen:${input.personId}:${transitionAt.toISOString()}:${recipient}`,
        });
      }
      return "FROZEN" as const;
    });

    if (result === "PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    if (result === "PERSON_NOT_FOUND") {
      return json({ error: result }, 404);
    }
    if (result === "PERSON_ALREADY_FROZEN" || result === "PERSON_NOT_FREEZABLE" || result === "PERSON_PROTECTED_ROLE") {
      return json({ error: result }, 409);
    }
    return json({ frozen: true });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
