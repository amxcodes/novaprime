import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const NOTIFICATION_EVENT_CATALOGUE = Object.freeze([
  { key: "leave.requested", label: "Leave requested", requiredInApp: true },
  { key: "leave.approved", label: "Leave approved", requiredInApp: true },
  { key: "leave.rejected", label: "Leave rejected", requiredInApp: true },
  { key: "wfh.requested", label: "WFH requested", requiredInApp: true },
  { key: "wfh.approved", label: "WFH approved", requiredInApp: true },
  { key: "wfh.rejected", label: "WFH rejected", requiredInApp: true },
  { key: "task.assigned", label: "Task assigned", requiredInApp: true },
  { key: "task.review_requested", label: "Review requested", requiredInApp: true },
  { key: "task.reviewer_unavailable", label: "Reviewer unavailable", requiredInApp: true },
  { key: "task.reviewer_request", label: "Reviewer request", requiredInApp: true },
  { key: "task.reviewer_request_expired", label: "Reviewer request expired", requiredInApp: true },
  { key: "task.reviewer_accepted", label: "Reviewer request accepted", requiredInApp: true },
  { key: "task.reviewer_declined", label: "Reviewer request declined", requiredInApp: true },
  { key: "task.handover_requested", label: "Task handover requested", requiredInApp: true },
  { key: "task.handover_request_expired", label: "Task handover request expired", requiredInApp: true },
  { key: "task.handover_accepted", label: "Task handover accepted", requiredInApp: true },
  { key: "task.handover_declined", label: "Task handover declined", requiredInApp: true },
  { key: "attendance.recovery_required", label: "Attendance recovery required", requiredInApp: true },
  { key: "attendance.recovered", label: "Attendance recovered", requiredInApp: true },
  { key: "attendance.location_rejected", label: "Attendance location rejected", requiredInApp: true },
  { key: "people.offboarding", label: "People offboarding", requiredInApp: true },
  { key: "people.frozen", label: "People frozen", requiredInApp: true },
  { key: "people.onboarded", label: "People onboarded", requiredInApp: true },
  { key: "people.owner_transferred", label: "Super Admin ownership transferred", requiredInApp: true },
  { key: "task.approved", label: "Task approved", requiredInApp: true },
  { key: "task.changes_requested", label: "Task changes requested", requiredInApp: true },
  { key: "task.cancelled", label: "Task cancelled", requiredInApp: true },
  { key: "task.reassigned", label: "Task reassigned", requiredInApp: true },
  { key: "task.due_soon", label: "Task due soon", requiredInApp: true },
  { key: "task.overdue", label: "Task overdue", requiredInApp: true },
  { key: "task.due_date_changed", label: "Task due date changed", requiredInApp: true },
  { key: "leave.cancelled", label: "Leave cancelled", requiredInApp: true },
  { key: "wfh.cancelled", label: "WFH cancelled", requiredInApp: true },
  { key: "availability.policy_changed", label: "Availability policy changed", requiredInApp: true },
  { key: "availability.calendar_changed", label: "Availability calendar changed", requiredInApp: true },
  { key: "availability.holiday_changed", label: "Office holiday changed", requiredInApp: true },
  { key: "availability.attendance_policy_changed", label: "Attendance policy changed", requiredInApp: true },
  { key: "people.role_changed", label: "Role permissions changed", requiredInApp: true },
] as const);

type NotificationEventKey = typeof NOTIFICATION_EVENT_CATALOGUE[number]["key"];

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }
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
  const result = await transaction.query<{ allowed: boolean }>(
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
     ) AS allowed`,
    [actorId, permissionKey],
  );
  return result.rows[0]?.allowed === true;
}

function eventDefinition(key: unknown) {
  return NOTIFICATION_EVENT_CATALOGUE.find((event) => event.key === key);
}

function notificationId(value: string): string | undefined {
  return uuidPattern.test(value) ? value : undefined;
}

export type NotificationIntent = Readonly<{
  organisationId: string;
  recipientPersonId: string;
  eventKey: NotificationEventKey;
  title: string;
  body: string;
  aggregateType?: string;
  aggregateId?: string;
  deepLink?: string;
  idempotencyKey: string;
}>;

/** Writes the in-app row atomically and stages email only when explicitly enabled. */
export async function enqueueNotification(
  transaction: PoolClient,
  intent: NotificationIntent,
): Promise<string> {
  const inserted = await transaction.query<{ id: string }>(
    `SELECT nova.enqueue_notification($1, $2, $3, $4, $5, $6, $7, $8, $9) AS id`,
    [intent.organisationId, intent.recipientPersonId, intent.eventKey, intent.title,
      intent.body, intent.aggregateType ?? null, intent.aggregateId ?? null,
      intent.deepLink ?? null, intent.idempotencyKey],
  );
  const row = inserted.rows[0];
  // A duplicate for another recipient is intentionally invisible through
  // recipient-scoped SELECT RLS; the idempotent insert is still a success.
  if (!row?.id) return "";

  const preference = await transaction.query<{ enabled: boolean }>(
    `SELECT nova.notification_email_enabled($1, $2) AS enabled`,
    [intent.recipientPersonId, intent.eventKey],
  );
  if (preference.rows[0]?.enabled === true) {
    await transaction.query(
      `SELECT nova.stage_notification_outbox($1, $2, $3, $4, $5::jsonb)`,
      [intent.organisationId, row.id, intent.recipientPersonId, intent.eventKey,
        JSON.stringify({ title: intent.title, body: intent.body, deepLink: intent.deepLink ?? null })],
    );
  }
  return row.id;
}

export async function readNotifications(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100);
  const unreadOnly = url.searchParams.get("unread") === "true";
  const eventKey = url.searchParams.get("eventKey");
  if (eventKey && !eventDefinition(eventKey)) return json({ error: "NOTIFICATION_EVENT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query(
        `SELECT id, event_key, title, body, aggregate_type, aggregate_id,
                deep_link, read_at, created_at, expires_at
         FROM nova.notifications
         WHERE organisation_id = $1 AND recipient_person_id = $2
           AND ($3::boolean = false OR read_at IS NULL)
           AND ($4::text IS NULL OR event_key = $4)
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY created_at DESC LIMIT $5`,
        [actor.context.organisationId, actor.context.userId, unreadOnly, eventKey ?? null, limit],
      );
      return rows.rows.map((row) => ({
        id: row.id, eventKey: row.event_key, title: row.title, body: row.body,
        aggregateType: row.aggregate_type, aggregateId: row.aggregate_id,
        deepLink: row.deep_link, readAt: row.read_at, createdAt: row.created_at,
        expiresAt: row.expires_at,
      }));
    });
    return json({ notifications: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readNotificationUnreadCount(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const count = await transaction.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM nova.notifications
         WHERE organisation_id = $1 AND recipient_person_id = $2
           AND read_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
        [actor.context.organisationId, actor.context.userId],
      );
      return Number(count.rows[0]?.count ?? 0);
    });
    return json({ count: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function markNotificationRead(request: Request, id: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const validId = notificationId(id);
  if (!validId) return json({ error: "NOTIFICATION_NOT_FOUND" }, 404);
  try {
    await withDatabaseRequest(actor.context, async (transaction) => {
      await transaction.query(
        `UPDATE nova.notifications SET read_at = COALESCE(read_at, clock_timestamp())
         WHERE id = $1 AND organisation_id = $2 AND recipient_person_id = $3`,
        [validId, actor.context.organisationId, actor.context.userId],
      );
    });
    return json({ ok: true });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function markAllNotificationsRead(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    await withDatabaseRequest(actor.context, async (transaction) => {
      await transaction.query(
        `UPDATE nova.notifications SET read_at = clock_timestamp()
         WHERE organisation_id = $1 AND recipient_person_id = $2 AND read_at IS NULL`,
        [actor.context.organisationId, actor.context.userId],
      );
    });
    return json({ ok: true });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readNotificationPreferences(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query<{ event_key: string; channel: string; enabled: boolean }>(
        `SELECT event_key, channel, enabled FROM nova.notification_preferences
         WHERE organisation_id = $1 AND person_id = $2 ORDER BY event_key, channel`,
        [actor.context.organisationId, actor.context.userId],
      );
      return NOTIFICATION_EVENT_CATALOGUE.flatMap((event) => [
        { eventKey: event.key, label: event.label, channel: "in_app", enabled: true, required: event.requiredInApp },
        { eventKey: event.key, label: event.label, channel: "email", enabled: rows.rows.find((row) => row.event_key === event.key && row.channel === "email")?.enabled === true, required: false },
      ]);
    });
    return json({ preferences: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function updateNotificationPreferences(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const body = await request.json().catch(() => ({}));
  const candidate = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const event = eventDefinition(candidate.eventKey);
  const channel = candidate.channel;
  if (!event || (channel !== "email" && channel !== "in_app") || typeof candidate.enabled !== "boolean") {
    return json({ error: "NOTIFICATION_PREFERENCE_INPUT_INVALID" }, 400);
  }
  if (channel === "in_app" && event.requiredInApp && candidate.enabled === false) {
    return json({ error: "NOTIFICATION_REQUIRED" }, 400);
  }
  try {
    await withDatabaseRequest(actor.context, async (transaction) => {
      await transaction.query(
        `INSERT INTO nova.notification_preferences (organisation_id, person_id, event_key, channel, enabled)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (person_id, event_key, channel)
         DO UPDATE SET organisation_id = EXCLUDED.organisation_id, enabled = EXCLUDED.enabled`,
        [actor.context.organisationId, actor.context.userId, event.key, channel, candidate.enabled],
      );
    });
    return json({ eventKey: event.key, channel, enabled: candidate.enabled });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readNotificationDelivery(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || 50), 1), 200);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "notifications.delivery.view")) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query(
        `SELECT * FROM nova.read_notification_delivery($1)`, [limit],
      );
      return rows.rows.map((row) => ({
        id: row.id, recipientPersonId: row.recipient_person_id, eventKey: row.event_key,
        status: row.status, attempts: row.attempts, availableAt: row.available_at,
        lastError: row.last_error, providerMessageId: row.provider_message_id,
        createdAt: row.created_at, sentAt: row.sent_at,
      }));
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ deliveries: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function requeueNotificationDelivery(request: Request, id: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const validId = notificationId(id);
  if (!validId) return json({ error: "NOTIFICATION_DELIVERY_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "notifications.manage")) return "PERMISSION_DENIED" as const;
      const updated = await transaction.query<{ requeued: boolean }>(
        `SELECT nova.requeue_notification_delivery($1) AS requeued`, [validId],
      );
      return updated.rows[0]?.requeued === true;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (!result) return json({ error: "NOTIFICATION_DELIVERY_NOT_FOUND" }, 404);
    return json({ id: validId, requeued: true });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
