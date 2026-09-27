import { timingSafeEqual } from "node:crypto";
import { database } from "./db.js";
import { processNotificationOutbox } from "./notification-worker.js";

export const backgroundSchedulers = ["cloudflare", "netlify", "vercel", "supabase", "vps"] as const;
export type BackgroundScheduler = typeof backgroundSchedulers[number];

export function configuredBackgroundScheduler(): BackgroundScheduler | null {
  const configured = process.env.NOVA_BACKGROUND_SCHEDULER;
  return backgroundSchedulers.find((scheduler) => scheduler === configured) ?? null;
}

export function backgroundSchedulerMatches(supplied: string | null): boolean {
  return supplied !== null && configuredBackgroundScheduler() === supplied;
}

export type BackgroundTickResult = Readonly<{
  closedAttendance: number;
  closedProvisionalWfhAttendance: number;
  closedWorkSessions: number;
  purgedEvidence: number;
  expiredRequests: number;
  reconciledReviewers: number;
  purgedIdempotencyKeys: number;
  notifications: number;
  dueNotifications: number;
  notificationError?: string;
}>;

export function backgroundJobSecretMatches(supplied: string | null): boolean {
  const expected = process.env.NOVA_BACKGROUND_JOB_SECRET;
  if (!expected || !supplied) return false;
  const received = Buffer.from(supplied);
  const target = Buffer.from(expected);
  return received.length === target.length && timingSafeEqual(received, target);
}

export async function runBackgroundTick(): Promise<BackgroundTickResult> {
  const attendance = await database().query<{ count: number }>(
    "SELECT nova.close_attendance_at_business_boundary($1) AS count",
    [1000],
  );
  const sessions = await database().query<{ count: number }>(
    "SELECT nova.close_work_sessions_at_business_boundary($1) AS count",
    [1000],
  );
  const provisionalWfh = await database().query<{ count: number }>(
    "SELECT nova.close_wfh_provisional_attendance_at_business_boundary($1) AS count",
    [1000],
  );
  const expiredRequests = await database().query<{ count: number }>(
    "SELECT nova.expire_task_requests($1) AS count",
    [1000],
  );
  const reconciledReviewers = await database().query<{ count: number }>(
    "SELECT nova.reconcile_unavailable_reviewers($1) AS count",
    [1000],
  );
  const purgedIdempotencyKeys = await database().query<{ count: number }>(
    "SELECT nova.purge_expired_api_idempotency_keys($1) AS count",
    [5000],
  );
  const purged = await database().query<{ count: number }>(
    "SELECT nova.purge_expired_attendance_location_evidence($1) AS count",
    [1000],
  );
  const due = await database().query<{ count: number }>(
    "SELECT nova.enqueue_due_task_notifications($1, $2) AS count",
    [1, 500],
  );
  let notifications = 0;
  let notificationError: string | undefined;
  try {
    notifications = await processNotificationOutbox(20);
  } catch (error) {
    // Delivery/provider faults must never prevent boundary closure. The
    // outbox lease/retry path will make the next tick safe and idempotent.
    notificationError = "NOTIFICATION_WORKER_FAILED";
    console.error(`[NOVA background] notification delivery deferred: ${error instanceof Error ? error.message.slice(0, 160) : notificationError}`);
  }
  return Object.freeze({
    closedAttendance: Number(attendance.rows[0]?.count ?? 0),
    closedWorkSessions: Number(sessions.rows[0]?.count ?? 0),
    closedProvisionalWfhAttendance: Number(provisionalWfh.rows[0]?.count ?? 0),
    expiredRequests: Number(expiredRequests.rows[0]?.count ?? 0),
    reconciledReviewers: Number(reconciledReviewers.rows[0]?.count ?? 0),
    purgedIdempotencyKeys: Number(purgedIdempotencyKeys.rows[0]?.count ?? 0),
    purgedEvidence: Number(purged.rows[0]?.count ?? 0),
    dueNotifications: Number(due.rows[0]?.count ?? 0),
    notifications,
    ...(notificationError ? { notificationError } : {}),
  });
}

export const runMaintenanceOnce = runBackgroundTick;

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runEndpointTick(endpoint: string): Promise<BackgroundTickResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.NOVA_BACKGROUND_JOB_SECRET ?? ""}`,
      "x-nova-background-scheduler": "vps",
    },
  });
  if (!response.ok) throw new Error(`BACKGROUND_JOB_HTTP_${response.status}`);
  const payload = await response.json() as { tick?: BackgroundTickResult };
  if (!payload.tick) throw new Error("BACKGROUND_JOB_RESPONSE_INVALID");
  return payload.tick;
}

if (import.meta.main) {
  const loop = process.env.NOVA_MAINTENANCE_LOOP === "true";
  const intervalSeconds = Number(process.env.NOVA_MAINTENANCE_INTERVAL_SECONDS ?? 60);
  const interval = Number.isInteger(intervalSeconds) && intervalSeconds >= 10 && intervalSeconds <= 86_400
    ? intervalSeconds * 1_000
    : 60_000;
  const defaultEndpoint = `http://127.0.0.1:${process.env.PORT ?? "3001"}/api/internal/background/tick`;
  let skipLogged = false;
  do {
    try {
      if (configuredBackgroundScheduler() !== "vps") {
        if (!skipLogged) console.info("[NOVA background] VPS worker idle; another scheduler is selected.");
        skipLogged = true;
      } else {
        const endpoint = process.env.NOVA_MAINTENANCE_ENDPOINT ?? defaultEndpoint;
        const result = await runEndpointTick(endpoint);
        console.info(`[NOVA background] closed ${result.closedAttendance} attendance row(s), ${result.closedWorkSessions} work session(s), expired ${result.expiredRequests} request(s), reconciled ${result.reconciledReviewers} reviewer(s), purged ${result.purgedEvidence} evidence row(s) and ${result.purgedIdempotencyKeys} idempotency key(s), created ${result.dueNotifications} reminder(s), processed ${result.notifications} notification(s)`);
      }
    } catch (error) {
      console.error("[NOVA background] tick failed", error);
      if (!loop) throw error;
    }
    if (loop) await wait(interval);
  } while (loop);
}
