import { afterEach, expect, test } from "bun:test";
import {
  backgroundNotificationBatchSize,
  backgroundJobSecretMatches,
  backgroundSchedulerMatches,
  configuredBackgroundScheduler,
  defaultMaintenanceIntervalSeconds,
  maintenanceIntervalMilliseconds,
  runEndpointTickWithRetry,
} from "./maintenance-worker.js";

const previous = process.env.NOVA_BACKGROUND_JOB_SECRET;
const previousScheduler = process.env.NOVA_BACKGROUND_SCHEDULER;
const previousFetch = globalThis.fetch;
const successfulTick = {
  closedAttendance: 0,
  closedProvisionalWfhAttendance: 0,
  closedWorkSessions: 0,
  purgedEvidence: 0,
  expiredRequests: 0,
  reconciledReviewers: 0,
  purgedIdempotencyKeys: 0,
  notifications: 0,
  dueNotifications: 0,
} as const;

afterEach(() => {
  if (previous === undefined) delete process.env.NOVA_BACKGROUND_JOB_SECRET;
  else process.env.NOVA_BACKGROUND_JOB_SECRET = previous;
  if (previousScheduler === undefined) delete process.env.NOVA_BACKGROUND_SCHEDULER;
  else process.env.NOVA_BACKGROUND_SCHEDULER = previousScheduler;
  globalThis.fetch = previousFetch;
});

test("selects only a supported deployment scheduler", () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "supabase";
  expect(configuredBackgroundScheduler()).toBe("supabase");
  expect(backgroundSchedulerMatches("supabase")).toBe(true);
  expect(backgroundSchedulerMatches("cloudflare")).toBe(false);
  process.env.NOVA_BACKGROUND_SCHEDULER = "unknown";
  expect(configuredBackgroundScheduler()).toBeNull();
});

test("serverless background notification work is kept to a small bounded batch", () => {
  expect(backgroundNotificationBatchSize).toBe(4);
});

test("self-hosted maintenance defaults to five minutes and accepts an explicit faster interval", () => {
  expect(defaultMaintenanceIntervalSeconds).toBe(300);
  expect(maintenanceIntervalMilliseconds(undefined)).toBe(300_000);
  expect(maintenanceIntervalMilliseconds("60")).toBe(60_000);
  expect(maintenanceIntervalMilliseconds("86400")).toBe(86_400_000);
});

test("self-hosted maintenance rejects malformed intervals rather than silently changing cadence", () => {
  for (const value of ["", "0", "9", "86401", "1.5", "1e3", "five"]) {
    expect(() => maintenanceIntervalMilliseconds(value)).toThrow("NOVA_MAINTENANCE_INTERVAL_SECONDS_INVALID");
  }
});

test("background tick accepts only the exact deployment secret", () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  expect(backgroundJobSecretMatches("tick-secret")).toBe(true);
  expect(backgroundJobSecretMatches("tick-secret-extra")).toBe(false);
  expect(backgroundJobSecretMatches(null)).toBe(false);
});

test("self-hosted endpoint retries transient connection failures with bounded backoff", async () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls < 3) {
      const cause = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      throw new TypeError("fetch failed", { cause });
    }
    return new Response(JSON.stringify({ tick: successfulTick }), { status: 200 });
  }) as unknown as typeof fetch;
  const pauses: number[] = [];

  await expect(runEndpointTickWithRetry(
    "http://api:3001/api/internal/background/tick",
    async (milliseconds) => { pauses.push(milliseconds); },
  )).resolves.toEqual(successfulTick);
  expect(calls).toBe(3);
  expect(pauses).toEqual([1_000, 2_000]);
});

test("self-hosted endpoint does not retry HTTP failures", async () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "BACKGROUND_SCHEDULER_NOT_CONFIGURED" }), { status: 503 });
  }) as unknown as typeof fetch;
  const pauses: number[] = [];

  await expect(runEndpointTickWithRetry(
    "http://api:3001/api/internal/background/tick",
    async (milliseconds) => { pauses.push(milliseconds); },
  )).rejects.toThrow("BACKGROUND_JOB_HTTP_503");
  expect(calls).toBe(1);
  expect(pauses).toEqual([]);
});

test("self-hosted endpoint retries only the API's transient background-tick failure", async () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: "BACKGROUND_JOB_FAILED" }), { status: 503 });
    }
    return new Response(JSON.stringify({ tick: successfulTick }), { status: 200 });
  }) as unknown as typeof fetch;
  const pauses: number[] = [];

  await expect(runEndpointTickWithRetry(
    "http://api:3001/api/internal/background/tick",
    async (milliseconds) => { pauses.push(milliseconds); },
  )).resolves.toEqual(successfulTick);
  expect(calls).toBe(2);
  expect(pauses).toEqual([1_000]);
});

test("self-hosted endpoint stops after the maximum connection retries", async () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  const failure = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw failure;
  }) as unknown as typeof fetch;
  const pauses: number[] = [];

  await expect(runEndpointTickWithRetry(
    "http://api:3001/api/internal/background/tick",
    async (milliseconds) => { pauses.push(milliseconds); },
  )).rejects.toBe(failure);
  expect(calls).toBe(5);
  expect(pauses).toEqual([1_000, 2_000, 4_000, 8_000]);
});
