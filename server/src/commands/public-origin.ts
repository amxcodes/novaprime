import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { authenticationConfiguration, bootstrapToken } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import {
  configuredPublicOrigins,
  normalizePublicOrigin,
  publicOriginForOrganisation,
} from "../public-origin.js";
import { isNormalOperationalActor, requestActor, type RequestActor } from "../request-actor.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function hasPermission(
  transaction: PoolClient,
  personId: string,
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
         AND grants.permission_key = 'organisation.public_origin.manage'
         AND grants.scope = 'organisation'
     ) AS permitted`,
    [personId],
  );
  return result.rows[0]?.permitted === true;
}

type ActorAccess = Readonly<{ actor: RequestActor; bootstrap: boolean }> | Readonly<{ response: Response }>;

function bootstrapOriginAccess(request: Request, actor: RequestActor): boolean {
  if (actor.session.emailVerified || actor.status !== "active") return false;
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

async function actorForRequest(request: Request): Promise<ActorAccess> {
  try {
    authenticationConfiguration();
  } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  const bootstrap = bootstrapOriginAccess(request, actor);
  if (!isNormalOperationalActor(actor) && !bootstrap) {
    return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  }
  return { actor, bootstrap };
}

export async function readPublicOrigin(request: Request): Promise<Response> {
  const access = await actorForRequest(request);
  if (!("actor" in access)) return access.response;

  try {
    const result = await withDatabaseRequest(access.actor.context, async (transaction) => {
      const permitted = access.bootstrap
        ? (await transaction.query<{ permitted: boolean }>(
          "SELECT nova.request_actor_is_super_admin() AS permitted",
        )).rows[0]?.permitted === true
        : await hasPermission(transaction, access.actor.context.userId);
      if (!permitted) return undefined;
      const row = await transaction.query<{ public_origin: string | null }>(
        "SELECT public_origin FROM nova.organisation_runtime_settings WHERE organisation_id = $1",
        [access.actor.context.organisationId],
      );
      const configured = row.rows[0]?.public_origin ?? null;
      return {
        allowedOrigins: configuredPublicOrigins(),
        configuredOrigin: configured && configuredPublicOrigins().includes(configured) ? configured : null,
        effectiveOrigin: await publicOriginForOrganisation(access.actor.context.organisationId),
      };
    });
    if (result === undefined) return json({ error: "PERMISSION_DENIED" }, 403);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updatePublicOrigin(request: Request): Promise<Response> {
  const access = await actorForRequest(request);
  if (!("actor" in access)) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "PUBLIC_ORIGIN_INPUT_INVALID" }, 400);
  }
  const candidate = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).origin
    : undefined;
  if (candidate !== null && candidate !== undefined && typeof candidate !== "string") {
    return json({ error: "PUBLIC_ORIGIN_INPUT_INVALID" }, 400);
  }
  const requested = candidate === null || candidate === undefined || candidate.trim() === ""
    ? null
    : normalizePublicOrigin(candidate);
  if (requested === undefined) {
    return json({ error: "PUBLIC_ORIGIN_INPUT_INVALID" }, 400);
  }

  let allowed: readonly string[];
  try {
    allowed = configuredPublicOrigins();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  if (requested !== null && !allowed.includes(requested)) {
    return json({ error: "PUBLIC_ORIGIN_NOT_ALLOWED", allowedOrigins: allowed }, 422);
  }

  try {
    const result = await withDatabaseRequest(access.actor.context, async (transaction) => {
      const permitted = access.bootstrap
        ? (await transaction.query<{ permitted: boolean }>(
          "SELECT nova.request_actor_is_super_admin() AS permitted",
        )).rows[0]?.permitted === true
        : await hasPermission(transaction, access.actor.context.userId);
      if (!permitted) return "PERMISSION_DENIED" as const;
      const current = await transaction.query<{ public_origin: string | null }>(
        "SELECT public_origin FROM nova.organisation_runtime_settings WHERE organisation_id = $1",
        [access.actor.context.organisationId],
      );
      if (requested !== current.rows[0]?.public_origin) {
        const oauth = await transaction.query<{ present: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM nova.email_oauth_attempts
             WHERE consumed_at IS NULL AND expires_at > now()
           ) AS present`,
        );
        if (oauth.rows[0]?.present === true) {
          return "PUBLIC_ORIGIN_CHANGE_BLOCKED_DURING_GMAIL_AUTH" as const;
        }
      }
      if (requested === null) {
        const active = await transaction.query<{ present: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM nova.email_provider_connections
             WHERE is_active
           ) AS present`,
        );
        if (active.rows[0]?.present === true) {
          return "PUBLIC_ORIGIN_REQUIRED_WHILE_EMAIL_ACTIVE" as const;
        }
      }
      await transaction.query(
        `INSERT INTO nova.organisation_runtime_settings (
           organisation_id, public_origin, updated_by_person_id
         ) VALUES ($1, $2, $3)
         ON CONFLICT (organisation_id) DO UPDATE SET
           public_origin = EXCLUDED.public_origin,
           updated_by_person_id = EXCLUDED.updated_by_person_id,
           updated_at = now()`,
        [access.actor.context.organisationId, requested, access.actor.context.userId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
           organisation_id, actor_person_id, action, target_type, target_id, details
         ) VALUES ($1, $2, 'organisation.public_origin.updated', 'organisation', $1, $3)`,
        [
          access.actor.context.organisationId,
          access.actor.context.userId,
          JSON.stringify({ public_origin: requested }),
        ],
      );
      return requested;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "PUBLIC_ORIGIN_REQUIRED_WHILE_EMAIL_ACTIVE") {
      return json({ error: result }, 409);
    }
    if (result === "PUBLIC_ORIGIN_CHANGE_BLOCKED_DURING_GMAIL_AUTH") {
      return json({ error: result }, 409);
    }
    const effectiveOrigin = await publicOriginForOrganisation(access.actor.context.organisationId);
    return json({
      configuredOrigin: result,
      effectiveOrigin,
      allowedOrigins: allowed,
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
