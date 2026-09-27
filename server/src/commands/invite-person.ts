import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { activeEmailConnection } from "./email-connections.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { EmailDeliveryError, sendEmail } from "../email-delivery.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { createManualAuthHandoff, stageAuthHandoffInTransaction } from "./auth-handoffs.js";
import { configuredPublicOriginForOrganisation, publicUrl } from "../public-origin.js";

type InvitePersonInput = Readonly<{
  displayName: string;
  deliveryMode: "auto" | "email" | "manual";
  email: string;
}>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function invitePersonInput(body: unknown): InvitePersonInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;
  const email = typeof candidate.email === "string"
    ? candidate.email.trim().toLowerCase()
    : "";
  if (
    typeof candidate.displayName !== "string" ||
    !candidate.displayName.trim() ||
    !emailPattern.test(email)
  ) {
    return undefined;
  }

  const deliveryMode = candidate.deliveryMode === undefined ? "auto" : candidate.deliveryMode;
  if (deliveryMode !== "auto" && deliveryMode !== "email" && deliveryMode !== "manual") {
    return undefined;
  }

  return Object.freeze({
    deliveryMode,
    displayName: candidate.displayName.trim(),
    email,
  });
}

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

async function canInvite(transaction: PoolClient, actorId: string): Promise<boolean> {
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
        AND grants.permission_key = 'people.invite'
        AND grants.scope = 'organisation'
    ) AS permitted`,
    [actorId],
  );

  return result.rows[0]?.permitted === true;
}

async function issueInvitation(
  context: DatabaseRequestContext,
  input: InvitePersonInput,
  rawToken: string,
  manualHandoff: boolean,
  origin: string,
): Promise<
  | Readonly<{ invitationId: string; manualHandoffId?: string; personId: string }>
  | "PERMISSION_DENIED"
  | "PERSON_ALREADY_EXISTS"
> {
  try {
    return await withDatabaseRequest(context, async (transaction) => {
      if (!await canInvite(transaction, context.userId)) {
        return "PERMISSION_DENIED";
      }

      const person = await transaction.query<{ id: string }>(
        `INSERT INTO nova.people (organisation_id, email, display_name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [context.organisationId, input.email, input.displayName],
      );
      const personId = person.rows[0]?.id;
      if (!personId) {
        throw new Error("INVITED_PERSON_CREATE_RESULT_MISSING");
      }

      await transaction.query(
        `INSERT INTO nova.person_status_periods (person_id, status, effective_at)
         VALUES ($1, 'invited', now())`,
        [personId],
      );
      const invitation = await transaction.query<{ id: string }>(
        `INSERT INTO nova.person_invitations (
          person_id, invitee_email, token_hash, expires_at
        ) VALUES ($1, $2, $3, now() + interval '7 days')
        RETURNING id`,
        [personId, input.email, tokenHash(rawToken)],
      );
      const invitationId = invitation.rows[0]?.id;
      if (!invitationId) {
        throw new Error("PERSON_INVITATION_CREATE_RESULT_MISSING");
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'people.invitation.created', 'person_invitation', $3, $4)`,
        [
          context.organisationId,
          context.userId,
          invitationId,
          JSON.stringify({ person_id: personId, expires_in_days: 7 }),
        ],
      );
      const manualHandoffId = manualHandoff
        ? await stageAuthHandoffInTransaction(transaction, {
          createdByPersonId: context.userId,
          expiresInSeconds: 7 * 24 * 60 * 60,
          organisationId: context.organisationId,
          purpose: "invitation",
          reason: "email_unavailable",
          targetPersonId: personId,
          url: invitationUrl(rawToken, origin),
        })
        : undefined;
      return Object.freeze({ invitationId, manualHandoffId, personId });
    });
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return "PERSON_ALREADY_EXISTS";
    }
    throw error;
  }
}

async function recordDelivery(
  context: DatabaseRequestContext,
  invitationId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await withDatabaseRequest(context, async (transaction) => {
    await transaction.query(
      `INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES ($1, $2, $3, 'person_invitation', $4, $5)`,
      [
        context.organisationId,
        context.userId,
        action,
        invitationId,
        JSON.stringify(details),
      ],
    );
  });
}

function invitationUrl(rawToken: string, origin: string): string {
  const url = new URL(publicUrl(origin, "/accept-invite"));
  // Keep the credential out of normal server request logs and referrer headers.
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

export async function invitePerson(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "PERSON_INVITATION_INPUT_INVALID" }, 400);
  }
  const input = invitePersonInput(body);
  if (!input) {
    return json({ error: "PERSON_INVITATION_INPUT_INVALID" }, 400);
  }

  const actor = await requestActor(request);
  if (!actor) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }
  if (!isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  const origin = await configuredPublicOriginForOrganisation(actor.context.organisationId);
  if (!origin) {
    return json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, 409);
  }

  let connection;
  let connectionUnavailable = false;
  try {
    connection = await activeEmailConnection();
  } catch (error) {
    if (error instanceof Error && error.message === "SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED") {
      return json({ error: error.message }, 503);
    }
    connectionUnavailable = true;
  }
  if (!connection && !connectionUnavailable && input.deliveryMode === "email") {
    return json({ error: "EMAIL_CONNECTION_NOT_ACTIVE" }, 409);
  }
  const manualHandoff = input.deliveryMode === "manual" || (!connection && !connectionUnavailable);
  const rawToken = randomBytes(32).toString("base64url");
  let issued: Awaited<ReturnType<typeof issueInvitation>>;
  try {
    issued = await issueInvitation(actor.context, input, rawToken, manualHandoff, origin);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
  if (issued === "PERMISSION_DENIED") {
    return json({ error: issued }, 403);
  }
  if (issued === "PERSON_ALREADY_EXISTS") {
    return json({ error: issued }, 409);
  }

  if (issued.manualHandoffId) {
    await recordDelivery(actor.context, issued.invitationId, "people.invitation.manual_handoff_staged", {
      handoff_id: issued.manualHandoffId,
    });
    return json({
      delivery: "manual",
      invitationId: issued.invitationId,
      manualHandoffId: issued.manualHandoffId,
      personId: issued.personId,
    }, 201);
  }

  if (!connection) {
    if (connectionUnavailable) {
      try {
        const manualHandoffId = await createManualAuthHandoff(actor.context, {
          expiresInSeconds: 7 * 24 * 60 * 60,
          purpose: "invitation",
          reason: "email_connection_unavailable",
          targetPersonId: issued.personId,
          url: invitationUrl(rawToken, origin),
        });
        await recordDelivery(actor.context, issued.invitationId, "people.invitation.manual_handoff_staged", {
          handoff_id: manualHandoffId,
          connection_unavailable: true,
        });
        return json({ delivery: "manual", invitationId: issued.invitationId, manualHandoffId, personId: issued.personId }, 202);
      } catch {
        // Fall through to the generic non-sensitive result below.
      }
    }
    return json({ error: "EMAIL_CONNECTION_NOT_ACTIVE", invitationId: issued.invitationId, personId: issued.personId }, 202);
  }

  try {
    await sendEmail(connection, {
      subject: "You are invited to NOVA",
      text: `You have been invited to NOVA. Create your password and verify your email using this one-time link:\n\n${invitationUrl(rawToken, origin)}`,
      to: input.email,
    });
    await recordDelivery(actor.context, issued.invitationId, "people.invitation.delivery_succeeded", {});
    return json({ invitationId: issued.invitationId, personId: issued.personId }, 201);
  } catch (error) {
    const deliveryError = error instanceof EmailDeliveryError
      ? error.code
      : "EMAIL_PROVIDER_DELIVERY_FAILED";
    await recordDelivery(
      actor.context,
      issued.invitationId,
      "people.invitation.delivery_failed",
      { error_code: deliveryError },
    ).catch(() => undefined);
    let manualHandoffId: string | undefined;
    try {
      manualHandoffId = await createManualAuthHandoff(actor.context, {
        expiresInSeconds: 7 * 24 * 60 * 60,
        purpose: "invitation",
        reason: "email_delivery_failed",
        targetPersonId: issued.personId,
        url: invitationUrl(rawToken, origin),
      });
      await recordDelivery(actor.context, issued.invitationId, "people.invitation.manual_handoff_staged", {
        handoff_id: manualHandoffId,
        delivery_failed: true,
      });
    } catch {
      // Keep the invitation response non-sensitive even if the recovery path
      // itself is unavailable; the audit event above still records the failure.
    }
    return json(
      {
        ...(manualHandoffId ? { delivery: "manual", manualHandoffId } : { error: "INVITATION_CREATED_EMAIL_NOT_SENT" }),
        invitationId: issued.invitationId,
        personId: issued.personId,
      },
      202,
    );
  }
}

async function reissueInvitation(
  context: DatabaseRequestContext,
  personId: string,
  rawToken: string,
  manualHandoff: boolean,
  origin: string,
): Promise<
  | Readonly<{ email: string; invitationId: string; manualHandoffId?: string }>
  | "INVITATION_ALREADY_CLAIMED"
  | "INVITATION_NOT_FOUND"
  | "PERMISSION_DENIED"
> {
  return withDatabaseRequest(context, async (transaction) => {
    if (!await canInvite(transaction, context.userId)) {
      return "PERMISSION_DENIED";
    }

    const open = await transaction.query<{
      email: string;
      invitation_id: string;
      pending_identity_subject: string | null;
    }>(
      `SELECT people.email, invitations.id AS invitation_id,
        invitations.pending_identity_subject
       FROM nova.person_invitations invitations
       JOIN nova.people people ON people.id = invitations.person_id
       WHERE invitations.person_id = $1
         AND invitations.accepted_at IS NULL
         AND invitations.revoked_at IS NULL
       FOR UPDATE OF invitations`,
      [personId],
    );
    const invitation = open.rows[0];
    if (!invitation) {
      return "INVITATION_NOT_FOUND";
    }
    if (invitation.pending_identity_subject) {
      return "INVITATION_ALREADY_CLAIMED";
    }

    await transaction.query(
      "UPDATE nova.person_invitations SET revoked_at = now() WHERE id = $1",
      [invitation.invitation_id],
    );
    const replacement = await transaction.query<{ id: string }>(
      `INSERT INTO nova.person_invitations (
        person_id, invitee_email, token_hash, expires_at
      ) VALUES ($1, $2, $3, now() + interval '7 days')
      RETURNING id`,
      [personId, invitation.email, tokenHash(rawToken)],
    );
    const invitationId = replacement.rows[0]?.id;
    if (!invitationId) {
      throw new Error("PERSON_INVITATION_REISSUE_RESULT_MISSING");
    }
    await transaction.query(
      `INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES ($1, $2, 'people.invitation.resent', 'person_invitation', $3, $4)`,
      [
        context.organisationId,
        context.userId,
        invitationId,
        JSON.stringify({ revoked_invitation_id: invitation.invitation_id }),
      ],
    );
    const manualHandoffId = manualHandoff
      ? await stageAuthHandoffInTransaction(transaction, {
        createdByPersonId: context.userId,
        expiresInSeconds: 7 * 24 * 60 * 60,
        organisationId: context.organisationId,
        purpose: "invitation",
        reason: "email_unavailable",
        targetPersonId: personId,
        url: invitationUrl(rawToken, origin),
      })
      : undefined;
    return Object.freeze({ email: invitation.email, invitationId, manualHandoffId });
  });
}

export async function resendInvitation(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "PERSON_INVITATION_INPUT_INVALID" }, 400);
  }
  const personId = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).personId
    : undefined;
  if (typeof personId !== "string" || !uuidPattern.test(personId)) {
    return json({ error: "PERSON_INVITATION_INPUT_INVALID" }, 400);
  }

  const actor = await requestActor(request);
  if (!actor) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }
  if (!isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  const deliveryMode = typeof body === "object" && body !== null &&
    ((body as Record<string, unknown>).deliveryMode === "email" || (body as Record<string, unknown>).deliveryMode === "manual")
    ? (body as Record<string, unknown>).deliveryMode as "email" | "manual"
    : "auto";
  let connection;
  let connectionUnavailable = false;
  try {
    connection = await activeEmailConnection();
  } catch (error) {
    if (error instanceof Error && error.message === "SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED") {
      return json({ error: error.message }, 503);
    }
    connectionUnavailable = true;
  }
  if (!connection && !connectionUnavailable && deliveryMode === "email") {
    return json({ error: "EMAIL_CONNECTION_NOT_ACTIVE" }, 409);
  }
  const manualHandoff = deliveryMode === "manual" || (!connection && !connectionUnavailable);
  const origin = await configuredPublicOriginForOrganisation(actor.context.organisationId);
  if (!origin) {
    return json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, 409);
  }

  const rawToken = randomBytes(32).toString("base64url");
  try {
    const resent = await reissueInvitation(actor.context, personId, rawToken, manualHandoff, origin);
    if (resent === "PERMISSION_DENIED") {
      return json({ error: resent }, 403);
    }
    if (resent === "INVITATION_NOT_FOUND") {
      return json({ error: resent }, 404);
    }
    if (resent === "INVITATION_ALREADY_CLAIMED") {
      return json({ error: resent }, 409);
    }

    if (resent.manualHandoffId) {
      await recordDelivery(actor.context, resent.invitationId, "people.invitation.manual_handoff_staged", {
        handoff_id: resent.manualHandoffId,
        resent: true,
      });
      return json({
        delivery: "manual",
        invitationId: resent.invitationId,
        manualHandoffId: resent.manualHandoffId,
      }, 201);
    }

    if (!connection) {
      if (connectionUnavailable) {
        try {
          const manualHandoffId = await createManualAuthHandoff(actor.context, {
            expiresInSeconds: 7 * 24 * 60 * 60,
            purpose: "invitation",
            reason: "email_connection_unavailable",
            targetPersonId: personId,
            url: invitationUrl(rawToken, origin),
          });
          await recordDelivery(actor.context, resent.invitationId, "people.invitation.manual_handoff_staged", {
            handoff_id: manualHandoffId,
            connection_unavailable: true,
            resent: true,
          });
          return json({ delivery: "manual", invitationId: resent.invitationId, manualHandoffId }, 202);
        } catch {
          // Fall through to the generic non-sensitive result below.
        }
      }
      return json({ error: "EMAIL_CONNECTION_NOT_ACTIVE", invitationId: resent.invitationId }, 202);
    }

    try {
      await sendEmail(connection, {
        subject: "Your new NOVA invitation link",
        text: `Use this new one-time NOVA invitation link to create your password:\n\n${invitationUrl(rawToken, origin)}`,
        to: resent.email,
      });
      await recordDelivery(actor.context, resent.invitationId, "people.invitation.delivery_succeeded", { resent: true });
      return json({ invitationId: resent.invitationId }, 201);
    } catch (error) {
      const deliveryError = error instanceof EmailDeliveryError
        ? error.code
        : "EMAIL_PROVIDER_DELIVERY_FAILED";
      await recordDelivery(
        actor.context,
        resent.invitationId,
        "people.invitation.delivery_failed",
        { error_code: deliveryError, resent: true },
      ).catch(() => undefined);
      let manualHandoffId: string | undefined;
      try {
        manualHandoffId = await createManualAuthHandoff(actor.context, {
          expiresInSeconds: 7 * 24 * 60 * 60,
          purpose: "invitation",
          reason: "email_delivery_failed",
          targetPersonId: personId,
          url: invitationUrl(rawToken, origin),
        });
        await recordDelivery(actor.context, resent.invitationId, "people.invitation.manual_handoff_staged", {
          handoff_id: manualHandoffId,
          delivery_failed: true,
          resent: true,
        });
      } catch {
        // The invitation remains valid and the delivery failure is already
        // audited; do not expose provider or encryption details to callers.
      }
      return json({
        ...(manualHandoffId ? { delivery: "manual", manualHandoffId } : { error: "INVITATION_CREATED_EMAIL_NOT_SENT" }),
        invitationId: resent.invitationId,
      }, 202);
    }
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
