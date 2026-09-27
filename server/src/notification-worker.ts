import { activeEmailConnection } from "./commands/email-connections.js";
import { database } from "./db.js";
import { EmailDeliveryError, sendEmail } from "./email-delivery.js";
import { configuredPublicOriginForOrganisation, publicUrl, rebasePublicUrl } from "./public-origin.js";

type ClaimedRow = Readonly<{
  id: string;
  organisation_id: string;
  recipient_email: string;
  event_key: string;
  payload: unknown;
  attempts: number;
  lease_token: string;
}>;

export function buildNotificationMessage(payload: unknown, origin: string): { subject: string; text: string } {
  if (typeof payload !== "object" || payload === null) throw new Error("NOTIFICATION_PAYLOAD_INVALID");
  const value = payload as Record<string, unknown>;
  const subject = typeof value.title === "string" ? value.title.trim() : "NOVA notification";
  const body = typeof value.body === "string" ? value.body.trim() : "You have a new NOVA notification.";
  const deepLink = typeof value.deepLink === "string" && value.deepLink
    ? `\n\nOpen NOVA: ${value.deepLink.startsWith("/") ? publicUrl(origin, value.deepLink) : rebasePublicUrl(value.deepLink, origin)}`
    : "";
  return { subject: subject || "NOVA notification", text: `${body || "You have a new NOVA notification."}${deepLink}` };
}

export async function processNotificationOutbox(limit = 20): Promise<number> {
  const connection = await activeEmailConnection();
  if (!connection) return 0;
  const pool = database();
  const claimed = await pool.query<ClaimedRow>(
    `SELECT id, organisation_id, recipient_email, event_key, payload, attempts, lease_token
     FROM nova.claim_notification_outbox($1, 120)`,
    [limit],
  );
  let processed = 0;
  for (const row of claimed.rows) {
    try {
      const lease = await pool.query<{ current: boolean }>(
        `SELECT nova.notification_outbox_lease_is_current($1, $2) AS current`,
        [row.id, row.lease_token],
      );
      if (lease.rows[0]?.current !== true) {
        processed += 1;
        continue;
      }
      const origin = await configuredPublicOriginForOrganisation(row.organisation_id);
      if (!origin) throw new Error("PUBLIC_ORIGIN_NOT_CONFIGURED");
      const mail = buildNotificationMessage(row.payload, origin);
      const providerMessageId = await sendEmail(connection, {
        to: row.recipient_email,
        subject: mail.subject,
        text: mail.text,
        messageId: `<nova-${row.id}@local>`,
      });
      await pool.query(
        `SELECT nova.finish_notification_outbox($1, $2, 'sent', NULL, $3, 300)`,
        [row.id, row.lease_token, providerMessageId ?? `<nova-${row.id}@local>`],
      );
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "NOTIFICATION_PAYLOAD_INVALID";
      const status = row.attempts >= 5 ? "dead_letter" : "failed";
      await pool.query(
        `SELECT nova.finish_notification_outbox($1, $2, $3, $4, NULL, 300)`,
        [row.id, row.lease_token, status, code],
      );
    }
    processed += 1;
  }
  return processed;
}

if (import.meta.main) {
  const processed = await processNotificationOutbox(Number(process.env.NOVA_NOTIFICATION_WORKER_BATCH ?? 20));
  console.info(`NOVA notification worker processed ${processed} row(s)`);
  await database().end();
}
