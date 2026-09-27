import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { authenticationConfiguration, bootstrapToken } from "../auth-configuration.js";
import {
  database,
  type DatabaseRequestContext,
  withDatabaseRequest,
} from "../db.js";
import { decryptSecret, encryptSecret } from "../secrets.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

export type AuthHandoffPurpose = "invitation" | "verification" | "password_reset";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const purposePermission: Record<AuthHandoffPurpose, string> = {
  invitation: "people.invite",
  verification: "auth.manual_recovery",
  password_reset: "auth.manual_recovery",
};

function bootstrapVerificationAccess(request: Request, actor: Awaited<ReturnType<typeof requestActor>>): boolean {
  if (!actor || actor.session.emailVerified || actor.status !== "active") return false;
  const supplied = request.headers.get("x-nova-bootstrap-token");
  if (!supplied) return false;
  try {
    const expected = Buffer.from(bootstrapToken());
    const received = Buffer.from(supplied);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

async function hasOrganisationPermission(
  transaction: PoolClient,
  personId: string,
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
    [personId, permissionKey],
  );
  return result.rows[0]?.permitted === true;
}

export async function stageAuthHandoffInTransaction(
  transaction: PoolClient,
  input: Readonly<{
    createdByPersonId?: string;
    expiresInSeconds: number;
    organisationId: string;
    purpose: AuthHandoffPurpose;
    reason: string;
    targetIdentitySubject?: string;
    targetPersonId: string;
    url: string;
  }>,
): Promise<string> {
  if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds <= 0) {
    throw new Error("AUTH_HANDOFF_TTL_INVALID");
  }
  const ciphertext = encryptSecret(input.url);
  await transaction.query(
    `UPDATE nova.auth_handoffs
     SET revoked_at = now()
     WHERE target_person_id = $1
       AND purpose = $2::nova.auth_handoff_purpose
       AND revealed_at IS NULL
       AND revoked_at IS NULL`,
    [input.targetPersonId, input.purpose],
  );
  const result = await transaction.query<{ id: string }>(
    `INSERT INTO nova.auth_handoffs (
     organisation_id, target_person_id, target_identity_subject, purpose,
     url_ciphertext, url_key_version, created_by_person_id, reason, expires_at
     ) VALUES ($1, $2, $3, $4::nova.auth_handoff_purpose, $5, 1, $6, $7,
               clock_timestamp() + ($8::int * interval '1 second'))
     RETURNING id`,
    [
      input.organisationId,
      input.targetPersonId,
      input.targetIdentitySubject ?? null,
      input.purpose,
      ciphertext,
      input.createdByPersonId ?? null,
      input.reason.trim(),
      input.expiresInSeconds,
    ],
  );
  const handoffId = result.rows[0]?.id;
  if (!handoffId) throw new Error("AUTH_HANDOFF_CREATE_RESULT_MISSING");
  await transaction.query(
    `INSERT INTO nova.audit_events (
       organisation_id, actor_person_id, action, target_type, target_id, details
     ) VALUES ($1, $2, 'auth.handoff.staged', 'auth_handoff', $3, $4)`,
    [
      input.organisationId,
      input.createdByPersonId ?? null,
      handoffId,
      JSON.stringify({ purpose: input.purpose, target_person_id: input.targetPersonId, reason: input.reason.trim() }),
    ],
  );
  return handoffId;
}

/** Used by Better Auth callbacks before a normal request actor exists. */
export async function stageAuthHandoffForIdentity(
  identitySubject: string,
  purpose: AuthHandoffPurpose,
  url: string,
  expiresInSeconds: number,
): Promise<boolean> {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("AUTH_HANDOFF_TTL_INVALID");
  }
  const result = await database().query<{ id: string | null }>(
    `SELECT nova.stage_auth_handoff(
       $1, $2::nova.auth_handoff_purpose, $3, 1::smallint,
       clock_timestamp() + ($4::int * interval '1 second'), $5
     ) AS id`,
    [identitySubject, purpose, encryptSecret(url), expiresInSeconds, "email_unavailable"],
  );
  return Boolean(result.rows[0]?.id);
}

export async function readAuthHandoffs(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  const bootstrapVerification = bootstrapVerificationAccess(request, actor);
  if (!bootstrapVerification && !isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (bootstrapVerification) {
        const protectedRole = await transaction.query<{ permitted: boolean }>(
          "SELECT nova.request_actor_is_super_admin() AS permitted",
        );
        if (protectedRole.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      }
      const canInvite = !bootstrapVerification && await hasOrganisationPermission(transaction, actor.context.userId, "people.invite");
      const canRecover = !bootstrapVerification && await hasOrganisationPermission(transaction, actor.context.userId, "auth.manual_recovery");
      if (!bootstrapVerification && !canInvite && !canRecover) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query(
        `SELECT handoffs.id, handoffs.purpose, handoffs.target_person_id,
                people.display_name, people.email, handoffs.reason,
                handoffs.expires_at, handoffs.created_at
         FROM nova.auth_handoffs handoffs
         JOIN nova.people people ON people.id = handoffs.target_person_id
         WHERE handoffs.organisation_id = $1
           AND handoffs.revealed_at IS NULL
           AND handoffs.revoked_at IS NULL
           AND handoffs.expires_at > now()
           AND handoffs.target_person_id = CASE WHEN $4 THEN $5::uuid ELSE handoffs.target_person_id END
           AND (
             ($2 AND handoffs.purpose = 'invitation')
             OR ($3 AND handoffs.purpose IN ('verification', 'password_reset'))
             OR ($4 AND handoffs.purpose = 'verification')
           )
         ORDER BY handoffs.created_at DESC`,
        [actor.context.organisationId, canInvite, canRecover, bootstrapVerification, actor.context.userId],
      );
      return rows.rows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        targetPersonId: row.target_person_id,
        targetDisplayName: row.display_name,
        targetEmail: row.email,
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ handoffs: result });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function revealAuthHandoff(request: Request, handoffId: string): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  if (!uuidPattern.test(handoffId)) return json({ error: "AUTH_HANDOFF_NOT_FOUND" }, 404);
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  const bootstrapVerification = bootstrapVerificationAccess(request, actor);
  if (!bootstrapVerification && !isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (bootstrapVerification) {
        const protectedRole = await transaction.query<{ permitted: boolean }>(
          "SELECT nova.request_actor_is_super_admin() AS permitted",
        );
        if (protectedRole.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      }
      const rowResult = await transaction.query<{
        id: string;
        purpose: AuthHandoffPurpose;
        target_person_id: string;
        url_ciphertext: Buffer;
        expires_at: Date;
        is_expired: boolean;
        revealed_at: Date | null;
        revoked_at: Date | null;
      }>(
        `SELECT id, purpose, target_person_id, url_ciphertext, expires_at,
                expires_at <= clock_timestamp() AS is_expired, revealed_at, revoked_at
         FROM nova.auth_handoffs
         WHERE id = $1 AND organisation_id = $2
         FOR UPDATE`,
        [handoffId, actor.context.organisationId],
      );
      const row = rowResult.rows[0];
      if (!row) return "AUTH_HANDOFF_NOT_FOUND" as const;
      if (bootstrapVerification
        ? (row.purpose !== "verification" || row.target_person_id !== actor.context.userId)
        : !await hasOrganisationPermission(transaction, actor.context.userId, purposePermission[row.purpose])) {
        return "PERMISSION_DENIED" as const;
      }
      if (row.revealed_at || row.revoked_at || row.is_expired) {
        return "AUTH_HANDOFF_NOT_AVAILABLE" as const;
      }
      const url = decryptSecret(row.url_ciphertext);
      await transaction.query(
        "UPDATE nova.auth_handoffs SET revealed_at = now() WHERE id = $1",
        [handoffId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
           organisation_id, actor_person_id, action, target_type, target_id, details
         ) VALUES ($1, $2, 'auth.handoff.revealed', 'auth_handoff', $3, $4)`,
        [
          actor.context.organisationId,
          actor.context.userId,
          handoffId,
          JSON.stringify({ purpose: row.purpose, target_person_id: row.target_person_id }),
        ],
      );
      return { purpose: row.purpose, targetPersonId: row.target_person_id, expiresAt: row.expires_at, url };
    });
    if (typeof result === "string") {
      return json({ error: result }, result === "AUTH_HANDOFF_NOT_FOUND" ? 404 : result === "PERMISSION_DENIED" ? 403 : 409);
    }
    return json({ handoff: result });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createManualAuthHandoff(
  context: DatabaseRequestContext,
  input: Readonly<{
    expiresInSeconds: number;
    purpose: AuthHandoffPurpose;
    reason: string;
    targetPersonId: string;
    url: string;
  }>,
): Promise<string> {
  return withDatabaseRequest(context, (transaction) => stageAuthHandoffInTransaction(transaction, {
    ...input,
    createdByPersonId: context.userId,
    organisationId: context.organisationId,
  }));
}
