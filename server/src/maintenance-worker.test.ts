import { afterEach, expect, test } from "bun:test";
import {
  backgroundNotificationBatchSize,
  backgroundTickLeaseHeartbeatMilliseconds,
  backgroundTickLeaseCheckpointRenewalFraction,
  backgroundTickLeaseSeconds,
  backgroundJobSecretMatches,
  backgroundSchedulerMatches,
  configuredBackgroundScheduler,
  defaultMaintenanceIntervalSeconds,
  maintenanceIntervalMilliseconds,
  runEndpointTickWithRetry,
  withBackgroundTickLease,
  type BackgroundTickLeaseStore,
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

function fakeLeaseStore(options: { acquire?: () => Promise<boolean>; renew?: () => Promise<boolean> } = {}) {
  let owner: string | undefined;
  let released = 0;
  let renewed = 0;
  const store: BackgroundTickLeaseStore = {
    async acquire(token) {
      if (options.acquire) return options.acquire();
      if (owner) return false;
      owner = token;
      return true;
    },
    async renew(token) {
      renewed += 1;
      if (options.renew) return options.renew();
      return owner === token;
    },
    async release(token) {
      if (owner === token) owner = undefined;
      released += 1;
    },
  };
  return { store, get owner() { return owner; }, get released() { return released; }, get renewed() { return renewed; } };
}

test("background single-flight defaults to a bounded renewable database lease", () => {
  expect(backgroundTickLeaseSeconds).toBe(180);
  expect(backgroundTickLeaseHeartbeatMilliseconds).toBe(30_000);
  expect(backgroundTickLeaseCheckpointRenewalFraction).toBe(2 / 3);
});

test("only one overlapping tick enters maintenance operations", async () => {
  const lease = fakeLeaseStore();
  let finishFirst!: () => void;
  let firstStarted = false;
  const first = withBackgroundTickLease(lease.store, async () => {
    firstStarted = true;
    await new Promise<void>((resolve) => { finishFirst = resolve; });
    return "first";
  }, { heartbeatMilliseconds: 60_000 });
  await Promise.resolve();
  expect(firstStarted).toBe(true);

  let secondEnteredOperations = false;
  await expect(withBackgroundTickLease(lease.store, async () => {
    secondEnteredOperations = true;
  })).resolves.toEqual({ acquired: false });
  expect(secondEnteredOperations).toBe(false);

  finishFirst();
  await expect(first).resolves.toEqual({ acquired: true, value: "first" });
  expect(lease.owner).toBeUndefined();
  expect(lease.released).toBe(1);
});

test("a tick renews while a maintenance operation is still running", async () => {
  const lease = fakeLeaseStore();
  const result = await withBackgroundTickLease(lease.store, async (checkpoint) => {
    await checkpoint();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await checkpoint();
    return "finished";
  }, { heartbeatMilliseconds: 5, leaseSeconds: 60 });

  expect(result).toEqual({ acquired: true, value: "finished" });
  expect(lease.renewed).toBeGreaterThanOrEqual(2);
  expect(lease.released).toBe(1);
});

test("fast tick checkpoints avoid extra database round trips before the renewal threshold", async () => {
  const lease = fakeLeaseStore();
  const result = await withBackgroundTickLease(lease.store, async (checkpoint) => {
    await checkpoint();
    await checkpoint();
    return "fast";
  }, { heartbeatMilliseconds: 60_000 });

  expect(result).toEqual({ acquired: true, value: "fast" });
  expect(lease.renewed).toBe(0);
  expect(lease.released).toBe(1);
});

test("checkpoint renews after two thirds of the lease TTL and resets its threshold", async () => {
  const lease = fakeLeaseStore();
  let nowMilliseconds = 0;
  const result = await withBackgroundTickLease(lease.store, async (checkpoint) => {
    await checkpoint();
    nowMilliseconds = 119_999;
    await checkpoint();
    expect(lease.renewed).toBe(0);
    nowMilliseconds = 120_000;
    await checkpoint();
    expect(lease.renewed).toBe(1);
    nowMilliseconds = 239_999;
    await checkpoint();
    expect(lease.renewed).toBe(1);
    nowMilliseconds = 240_000;
    await checkpoint();
    expect(lease.renewed).toBe(2);
    return "renewed";
  }, {
    heartbeatMilliseconds: 60_000,
    leaseSeconds: 180,
    nowMilliseconds: () => nowMilliseconds,
  });

  expect(result).toEqual({ acquired: true, value: "renewed" });
});

test("a failed lease renewal fences later maintenance steps and still releases", async () => {
  const lease = fakeLeaseStore({ renew: async () => false });
  let nowMilliseconds = 0;
  let laterStepRan = false;
  await expect(withBackgroundTickLease(lease.store, async (checkpoint) => {
    nowMilliseconds = 120_000;
    await checkpoint();
    laterStepRan = true;
  }, {
    heartbeatMilliseconds: 60_000,
    nowMilliseconds: () => nowMilliseconds,
  })).rejects.toThrow("BACKGROUND_TICK_LEASE_LOST");
  expect(laterStepRan).toBe(false);
  expect(lease.released).toBe(1);
});

test("a heartbeat that loses its lease prevents the next tick step", async () => {
  const lease = fakeLeaseStore({ renew: async () => false });
  let laterStepRan = false;
  await expect(withBackgroundTickLease(lease.store, async (checkpoint) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    await checkpoint();
    laterStepRan = true;
  }, { heartbeatMilliseconds: 2, leaseSeconds: 60 })).rejects.toThrow("BACKGROUND_TICK_LEASE_LOST");

  expect(lease.renewed).toBeGreaterThanOrEqual(1);
  expect(laterStepRan).toBe(false);
  expect(lease.released).toBe(1);
});

test("a final in-flight renewal failure is not reported as a completed tick", async () => {
  let finishRenewal!: (renewed: boolean) => void;
  const lease = fakeLeaseStore({
    renew: () => new Promise<boolean>((resolve) => { finishRenewal = resolve; }),
  });
  const tick = withBackgroundTickLease(lease.store, async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return "finished";
  }, { heartbeatMilliseconds: 2, leaseSeconds: 60 });

  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(finishRenewal).toBeFunction();
  finishRenewal(false);
  await expect(tick).rejects.toThrow("BACKGROUND_TICK_LEASE_LOST");
  expect(lease.released).toBe(1);
});

test("a failed lease acquisition fails closed without entering the tick", async () => {
  const lease = fakeLeaseStore({ acquire: async () => { throw new Error("database unavailable"); } });
  let entered = false;
  await expect(withBackgroundTickLease(lease.store, async () => { entered = true; })).rejects.toThrow("database unavailable");
  expect(entered).toBe(false);
  expect(lease.released).toBe(0);
});

test("tick failures release their lease before propagating", async () => {
  const lease = fakeLeaseStore();
  await expect(withBackgroundTickLease(lease.store, async () => {
    throw new Error("maintenance failed");
  })).rejects.toThrow("maintenance failed");
  expect(lease.owner).toBeUndefined();
  expect(lease.released).toBe(1);
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
