import { expect, test } from "bun:test";
import type { Pool, PoolClient } from "pg";
const {
  createDatabaseDiagnostics,
  instrumentDatabasePool,
  withDatabaseDiagnostics,
} = await import("./database-diagnostics");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promisePool(query: () => Promise<unknown>): Pool {
  const client = { query } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

test("measures promise pool acquisition and query round trips without recording SQL", async () => {
  const pool = instrumentDatabasePool(promisePool(async () => {
    await delay(8);
    return { rows: [] };
  }), "nova");
  const metrics = createDatabaseDiagnostics();

  await withDatabaseDiagnostics(metrics, async () => {
    const client = await pool.connect();
    await client.query("sensitive query text");
  });

  expect(metrics.nova.poolAcquisitions).toBe(1);
  expect(metrics.nova.poolAcquireMs).toBeGreaterThanOrEqual(0);
  expect(metrics.nova.queries).toBe(1);
  expect(metrics.nova.queryRoundTripMs).toBeGreaterThanOrEqual(5);
  expect(metrics.nova.maxQueryRoundTripMs).toBeGreaterThanOrEqual(5);
  expect(metrics.auth.queries).toBe(0);
});

test("measures callback pool acquisition and callback query completion", async () => {
  const client = {
    query: (_statement: string, callback?: (error: Error | null) => void) => {
      setTimeout(() => callback?.(null), 5);
    },
  } as unknown as PoolClient;
  const pool = instrumentDatabasePool({
    connect: (callback: (error: Error | null, connection: PoolClient, release: () => void) => void) => {
      setTimeout(() => callback(null, client, () => undefined), 3);
    },
    query(
      this: { connect: (callback: (error: Error | null, connection: PoolClient) => void) => void },
      statement: string,
      callback: (error: Error | null, result?: unknown) => void,
    ) {
      this.connect((error, connection) => {
        if (error) return callback(error);
        connection.query(statement, callback);
      });
    },
  } as unknown as Pool, "auth") as unknown as {
    query: (statement: string, callback: (error: Error | null, result?: unknown) => void) => void;
  };
  const metrics = createDatabaseDiagnostics();

  await withDatabaseDiagnostics(metrics, () => new Promise<void>((resolve, reject) => {
    pool.query("sensitive query text", (error) => {
      if (error) return reject(error);
      resolve();
    });
  }));

  expect(metrics.auth.poolAcquisitions).toBe(1);
  expect(metrics.auth.queries).toBe(1);
  expect(metrics.auth.queryFailures).toBe(0);
  expect(metrics.nova.queries).toBe(0);
});

test("keeps overlapping request metrics isolated and counts query failures", async () => {
  const novaPool = instrumentDatabasePool(promisePool(async () => {
    await delay(8);
    return { rows: [] };
  }), "nova");
  const authPool = instrumentDatabasePool(promisePool(async () => {
    await delay(12);
    throw new Error("private query failure");
  }), "auth");
  const novaMetrics = createDatabaseDiagnostics();
  const authMetrics = createDatabaseDiagnostics();

  await Promise.all([
    withDatabaseDiagnostics(novaMetrics, async () => {
      const client = await novaPool.connect();
      await client.query("nova query");
    }),
    withDatabaseDiagnostics(authMetrics, async () => {
      const client = await authPool.connect();
      await client.query("auth query").catch(() => undefined);
    }),
  ]);

  expect(novaMetrics.nova.queries).toBe(1);
  expect(novaMetrics.auth.queries).toBe(0);
  expect(authMetrics.auth.queries).toBe(1);
  expect(authMetrics.auth.queryFailures).toBe(1);
  expect(authMetrics.nova.queries).toBe(0);
});

test("continues timing a checked-out client acquired outside a request context", async () => {
  const pool = instrumentDatabasePool(promisePool(async () => ({ rows: [] })), "nova");
  const client = await pool.connect();
  const metrics = createDatabaseDiagnostics();

  await withDatabaseDiagnostics(metrics, () => client.query("request query"));

  expect(metrics.nova.poolAcquisitions).toBe(0);
  expect(metrics.nova.queries).toBe(1);
});
