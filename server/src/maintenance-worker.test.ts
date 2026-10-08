import { afterEach, expect, test } from "bun:test";
import {
  backgroundNotificationBatchSize,
  backgroundJobSecretMatches,
  backgroundSchedulerMatches,
  configuredBackgroundScheduler,
  defaultMaintenanceIntervalSeconds,
  maintenanceIntervalMilliseconds,
} from "./maintenance-worker.js";

const previous = process.env.NOVA_BACKGROUND_JOB_SECRET;
const previousScheduler = process.env.NOVA_BACKGROUND_SCHEDULER;

afterEach(() => {
  if (previous === undefined) delete process.env.NOVA_BACKGROUND_JOB_SECRET;
  else process.env.NOVA_BACKGROUND_JOB_SECRET = previous;
  if (previousScheduler === undefined) delete process.env.NOVA_BACKGROUND_SCHEDULER;
  else process.env.NOVA_BACKGROUND_SCHEDULER = previousScheduler;
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
