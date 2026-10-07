import { expect, test } from "bun:test";
import { createDatabaseAuthRateLimitStorage } from "./auth-rate-limit-storage.js";

function queuedQuery(responses: Array<Record<string, unknown>[]>) {
  const calls: Array<{ statement: string; parameters: readonly (string | number)[] }> = [];
  const query = async (statement: string, parameters: readonly (string | number)[]) => {
    calls.push({ statement, parameters });
    const rows = responses.shift();
    if (!rows) throw new Error("UNEXPECTED_AUTH_RATE_LIMIT_QUERY");
    return { rows };
  };
  return { calls, query };
}

test("an allowed request is admitted by one atomic database statement", async () => {
  const { calls, query } = queuedQuery([[{ count: 1, should_prune: false }]]);
  const storage = createDatabaseAuthRateLimitStorage(query);

  expect(await storage.consume("test:session", { window: 10, max: 100 }))
    .toEqual({ allowed: true, retryAfter: null });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.statement).toContain("ON CONFLICT (key) DO UPDATE");
  expect(calls[0]?.statement).toContain("current_rate_limit.count < $4");
});

test("a denial reads the latest retry delay without issuing a write", async () => {
  const { calls, query } = queuedQuery([
    [],
    [{ last_request: "1000", now_ms: "2001", expired: false, retry_after: 9 }],
  ]);
  const storage = createDatabaseAuthRateLimitStorage(query);

  expect(await storage.consume("test:sign-in", { window: 10, max: 3 }))
    .toEqual({ allowed: false, retryAfter: 9 });
  expect(calls).toHaveLength(2);
  expect(calls[1]?.statement).toContain("SELECT rate_limit.\"lastRequest\"");
  expect(calls.some((call) => call.statement.startsWith("DELETE"))).toBe(false);
});

test("an expiry between denial and fresh read retries the atomic decision", async () => {
  const { calls, query } = queuedQuery([
    [],
    [{ last_request: "1000", now_ms: "11000", expired: true, retry_after: 1 }],
    [{ count: 1, should_prune: true }],
    [],
  ]);
  const storage = createDatabaseAuthRateLimitStorage(query);

  expect(await storage.consume("test:expired", { window: 10, max: 1 }))
    .toEqual({ allowed: true, retryAfter: null });
  expect(calls).toHaveLength(4);
  expect(calls[2]?.statement).toContain("ON CONFLICT (key) DO UPDATE");
  expect(calls[3]?.statement).toContain("DELETE FROM nova_auth.\"rateLimit\"");
});

test("invalid rules fail before touching PostgreSQL", async () => {
  const { calls, query } = queuedQuery([]);
  const storage = createDatabaseAuthRateLimitStorage(query);

  await expect(storage.consume("test:invalid", { window: 10, max: 0 }))
    .rejects.toThrow("AUTH_RATE_LIMIT_RULE_INVALID");
  expect(calls).toHaveLength(0);
});
