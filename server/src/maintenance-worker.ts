import { randomUUID, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { database } from "./db.js";
import { processNotificationOutbox } from "./notification-worker.js";

export const backgroundSchedulers = ["cloudflare", "netlify", "vercel", "supabase", "vps"] as const;
export type BackgroundScheduler = typeof backgroundSchedulers[number];

// Keep serverless ticks comfortably below their request deadline. The outbox
// is durable, so a tick intentionally sends a small concurrent slice; later
// ticks continue the remaining work without holding a function open for a
// serial chain of provider timeouts.
export const backgroundNotificationBatchSize = 4;
export const defaultMaintenanceIntervalSeconds = 300;
export const backgroundTickLeaseSeconds = 180;
export const backgroundTickLeaseHeartbeatMilliseconds = 30_000;
export const backgroundTickLeaseCheckpointRenewalFraction = 2 / 3;

export function maintenanceIntervalMilliseconds(value: string | undefined): number {
  if (value === undefined) return defaultMaintenanceIntervalSeconds * 1_000;
  if (!/^\d+$/.test(value)) throw new Error("NOVA_MAINTENANCE_INTERVAL_SECONDS_INVALID");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 10 || seconds > 86_400) {
    throw new Error("NOVA_MAINTENANCE_INTERVAL_SECONDS_INVALID");
  }
  return seconds * 1_000;
}

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
  skipped?: boolean;
  notificationError?: string;
}>;

export interface BackgroundTickLeaseStore {
  acquire(ownerToken: string, leaseSeconds: number): Promise<boolean>;
  renew(ownerToken: string, leaseSeconds: number): Promise<boolean>;
  release(ownerToken: string): Promise<void>;
}

/**
 * Run one maintenance tick under a database-backed, expiring lease. The lease
 * is acquired and renewed in individual SQL statements, so it remains safe on
 * direct PostgreSQL, Supabase transaction pooling, and Cloudflare Hyperdrive.
 * The caller must checkpoint before each independently committing operation.
 */
export async function withBackgroundTickLease<T>(
  store: BackgroundTickLeaseStore,
  operation: (checkpoint: () => Promise<void>) => Promise<T>,
  options: Readonly<{
    heartbeatMilliseconds?: number;
    leaseSeconds?: number;
    nowMilliseconds?: () => number;
  }> = {},
): Promise<Readonly<{ acquired: false } | { acquired: true; value: T }>> {
  const leaseSeconds = options.leaseSeconds ?? backgroundTickLeaseSeconds;
  const heartbeatMilliseconds = options.heartbeatMilliseconds ?? backgroundTickLeaseHeartbeatMilliseconds;
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 900 ||
      !Number.isSafeInteger(heartbeatMilliseconds) || heartbeatMilliseconds < 1 ||
      heartbeatMilliseconds >= leaseSeconds * 1_000) {
    throw new Error("BACKGROUND_TICK_LEASE_CONFIGURATION_INVALID");
  }

  const ownerToken = randomUUID();
  if (!await store.acquire(ownerToken, leaseSeconds)) return { acquired: false };

  let leaseFailure: Error | undefined;
  let renewal: Promise<void> | undefined;
  const nowMilliseconds = options.nowMilliseconds ?? (() => performance.now());
  const checkpointRenewalInterval = leaseSeconds * 1_000 * backgroundTickLeaseCheckpointRenewalFraction;
  // Keep at least one third of the database TTL in reserve. For the normal
  // 180-second lease, checkpoints renew at 120 seconds; the 30-second
  // heartbeat refreshes a tick that remains busy between checkpoints.
  let renewAtMilliseconds = nowMilliseconds() + checkpointRenewalInterval;
  const renew = (): Promise<void> => {
    if (leaseFailure) return Promise.reject(leaseFailure);
    if (!renewal) {
      renewal = (async () => {
        try {
          if (!await store.renew(ownerToken, leaseSeconds)) {
            throw new Error("BACKGROUND_TICK_LEASE_LOST");
          }
          renewAtMilliseconds = nowMilliseconds() + checkpointRenewalInterval;
        } catch {
          leaseFailure = new Error("BACKGROUND_TICK_LEASE_LOST");
          throw leaseFailure;
        }
      })().finally(() => { renewal = undefined; });
    }
    return renewal;
  };
  const checkpoint = async (): Promise<void> => {
    if (leaseFailure) throw leaseFailure;
    if (nowMilliseconds() >= renewAtMilliseconds) await renew();
    if (leaseFailure) throw leaseFailure;
  };

  const heartbeat = setInterval(() => { void renew().catch(() => undefined); }, heartbeatMilliseconds);
  heartbeat.unref?.();
  try {
    const value = await operation(checkpoint);
    // If a heartbeat was already in flight as the final operation returned,
    // observe it before reporting success. Otherwise a lost lease at the end
    // of the tick could be silently reported as a completed tick.
    await renewal?.catch(() => undefined);
    if (leaseFailure) throw leaseFailure;
    return { acquired: true, value };
  } finally {
    clearInterval(heartbeat);
    await renewal?.catch(() => undefined);
    try {
      await store.release(ownerToken);
    } catch (error) {
      // The lease will expire if the release write fails. Never hide the tick
      // result (or original failure) behind a best-effort cleanup error.
      console.error(`[NOVA background] lease release deferred: ${error instanceof Error ? error.message.slice(0, 160) : "DATABASE_ERROR"}`);
    }
  }
}

export function backgroundJobSecretMatches(supplied: string | null): boolean {
  const expected = process.env.NOVA_BACKGROUND_JOB_SECRET;
  if (!expected || !supplied) return false;
  const received = Buffer.from(supplied);
  const target = Buffer.from(expected);
  return received.length === target.length && timingSafeEqual(received, target);
}

async function runBackgroundTickOperations(checkpoint: () => Promise<void>): Promise<BackgroundTickResult> {
  await checkpoint();
  const attendance = await database().query<{ count: number }>(
    "SELECT nova.close_attendance_at_business_boundary($1) AS count",
    [1000],
  );
  await checkpoint();
  const sessions = await database().query<{ count: number }>(
    "SELECT nova.close_work_sessions_at_business_boundary($1) AS count",
    [1000],
  );
  await checkpoint();
  const provisionalWfh = await database().query<{ count: number }>(
    "SELECT nova.close_wfh_provisional_attendance_at_business_boundary($1) AS count",
    [1000],
  );
  await checkpoint();
  const expiredRequests = await database().query<{ count: number }>(
    "SELECT nova.expire_task_requests($1) AS count",
    [1000],
  );
  await checkpoint();
  const reconciledReviewers = await database().query<{ count: number }>(
    "SELECT nova.reconcile_unavailable_reviewers($1) AS count",
    [1000],
  );
  await checkpoint();
  const purgedIdempotencyKeys = await database().query<{ count: number }>(
    "SELECT nova.purge_expired_api_idempotency_keys($1) AS count",
    [5000],
  );
  await checkpoint();
  const purged = await database().query<{ count: number }>(
    "SELECT nova.purge_expired_attendance_location_evidence($1) AS count",
    [1000],
  );
  await checkpoint();
  const due = await database().query<{ count: number }>(
    "SELECT nova.enqueue_due_task_notifications($1, $2) AS count",
    [1, 500],
  );
  let notifications = 0;
  let notificationError: string | undefined;
  try {
    await checkpoint();
    notifications = await processNotificationOutbox(
      backgroundNotificationBatchSize,
      backgroundNotificationBatchSize,
    );
  } catch (error) {
    // Delivery/provider faults must never prevent boundary closure. The
    // outbox lease/retry path will make the next tick safe and idempotent.
    notificationError = "NOTIFICATION_WORKER_FAILED";
    console.error(`[NOVA background] notification delivery deferred: ${error instanceof Error ? error.message.slice(0, 160) : notificationError}`);
  }
  // A lost lease must stop the tick even if the outbox itself failed; keep
  // this outside the provider-error catch above.
  await checkpoint();
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

const databaseBackgroundTickLeaseStore: BackgroundTickLeaseStore = {
  async acquire(ownerToken, leaseSeconds) {
    const result = await database().query<{ acquired: boolean }>(
      "SELECT nova.try_acquire_background_tick_lease($1::uuid, $2::integer) AS acquired",
      [ownerToken, leaseSeconds],
    );
    return result.rows[0]?.acquired === true;
  },
  async renew(ownerToken, leaseSeconds) {
    const result = await database().query<{ renewed: boolean }>(
      "SELECT nova.renew_background_tick_lease($1::uuid, $2::integer) AS renewed",
      [ownerToken, leaseSeconds],
    );
    return result.rows[0]?.renewed === true;
  },
  async release(ownerToken) {
    await database().query(
      "SELECT nova.release_background_tick_lease($1::uuid)",
      [ownerToken],
    );
  },
};

export async function runBackgroundTick(): Promise<BackgroundTickResult> {
  const result = await withBackgroundTickLease(
    databaseBackgroundTickLeaseStore,
    runBackgroundTickOperations,
  );
  if (result.acquired) return result.value;
  console.info("[NOVA background] tick skipped; another tick holds the database lease.");
  return Object.freeze({
    closedAttendance: 0,
    closedProvisionalWfhAttendance: 0,
    closedWorkSessions: 0,
    purgedEvidence: 0,
    expiredRequests: 0,
    reconciledReviewers: 0,
    purgedIdempotencyKeys: 0,
    notifications: 0,
    dueNotifications: 0,
    skipped: true,
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
  if (!response.ok) {
    if (response.status === 503) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (body?.error === "BACKGROUND_JOB_FAILED") {
        throw new Error("BACKGROUND_JOB_TICK_RETRYABLE");
      }
    }
    throw new Error(`BACKGROUND_JOB_HTTP_${response.status}`);
  }
  const payload = await response.json() as { tick?: BackgroundTickResult };
  if (!payload.tick) throw new Error("BACKGROUND_JOB_RESPONSE_INVALID");
  return payload.tick;
}

const transientEndpointErrorCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function isTransientEndpointConnectionError(error: unknown): boolean {
  let current = error;
  const visited = new Set<unknown>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { cause?: unknown; code?: unknown };
    if (current instanceof Error && current.message === "BACKGROUND_JOB_TICK_RETRYABLE") return true;
    if (typeof candidate.code === "string" && transientEndpointErrorCodes.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
}

export async function runEndpointTickWithRetry(
  endpoint: string,
  pause: (milliseconds: number) => Promise<void> = wait,
): Promise<BackgroundTickResult> {
  const retryDelays = [1_000, 2_000, 4_000, 8_000] as const;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runEndpointTick(endpoint);
    } catch (error) {
      const delay = retryDelays[attempt];
      if (delay === undefined || !isTransientEndpointConnectionError(error)) throw error;
      await pause(delay);
    }
  }
}

if (import.meta.main) {
  const loop = process.env.NOVA_MAINTENANCE_LOOP === "true";
  const interval = loop ? maintenanceIntervalMilliseconds(process.env.NOVA_MAINTENANCE_INTERVAL_SECONDS) : 0;
  const defaultEndpoint = `http://127.0.0.1:${process.env.PORT ?? "3001"}/api/internal/background/tick`;
  let skipLogged = false;
  do {
    try {
      if (configuredBackgroundScheduler() !== "vps") {
        if (!skipLogged) console.info("[NOVA background] VPS worker idle; another scheduler is selected.");
        skipLogged = true;
      } else {
        const endpoint = process.env.NOVA_MAINTENANCE_ENDPOINT ?? defaultEndpoint;
        const result = await runEndpointTickWithRetry(endpoint);
        console.info(`[NOVA background] closed ${result.closedAttendance} attendance row(s), ${result.closedWorkSessions} work session(s), expired ${result.expiredRequests} request(s), reconciled ${result.reconciledReviewers} reviewer(s), purged ${result.purgedEvidence} evidence row(s) and ${result.purgedIdempotencyKeys} idempotency key(s), created ${result.dueNotifications} reminder(s), processed ${result.notifications} notification(s)`);
      }
    } catch (error) {
      console.error("[NOVA background] tick failed", error);
      if (!loop) throw error;
    }
    if (loop) await wait(interval);
  } while (loop);
}
