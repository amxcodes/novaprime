import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

export type DatabasePoolDiagnostics = Readonly<{
  poolAcquisitions: number;
  poolAcquireMs: number;
  poolAcquireFailures: number;
  queries: number;
  queryRoundTripMs: number;
  queryFailures: number;
  maxQueryRoundTripMs: number;
}>;

export type DatabaseDiagnostics = Readonly<{
  nova: DatabasePoolDiagnostics;
  auth: DatabasePoolDiagnostics;
}>;

type MutableDatabasePoolDiagnostics = {
  poolAcquisitions: number;
  poolAcquireMs: number;
  poolAcquireFailures: number;
  queries: number;
  queryRoundTripMs: number;
  queryFailures: number;
  maxQueryRoundTripMs: number;
};

type MutableDatabaseDiagnostics = {
  nova: MutableDatabasePoolDiagnostics;
  auth: MutableDatabasePoolDiagnostics;
};

type DatabasePoolSource = keyof MutableDatabaseDiagnostics;

export type RequestDatabaseDiagnostics = { database?: DatabaseDiagnostics };

const requestDatabaseDiagnostics = new AsyncLocalStorage<MutableDatabaseDiagnostics>();
const instrumentedPools = new WeakSet<Pool>();
const instrumentedClients = new WeakSet<object>();

function emptyPoolDiagnostics(): MutableDatabasePoolDiagnostics {
  return {
    poolAcquisitions: 0,
    poolAcquireMs: 0,
    poolAcquireFailures: 0,
    queries: 0,
    queryRoundTripMs: 0,
    queryFailures: 0,
    maxQueryRoundTripMs: 0,
  };
}

export function createDatabaseDiagnostics(): MutableDatabaseDiagnostics {
  return { nova: emptyPoolDiagnostics(), auth: emptyPoolDiagnostics() };
}

export function withDatabaseDiagnostics<T>(
  diagnostics: MutableDatabaseDiagnostics,
  operation: () => Promise<T>,
): Promise<T> {
  return requestDatabaseDiagnostics.run(diagnostics, operation);
}

export function readDatabaseDiagnostics(
  diagnostics: MutableDatabaseDiagnostics,
): DatabaseDiagnostics {
  return { nova: { ...diagnostics.nova }, auth: { ...diagnostics.auth } };
}

function recordPoolAcquisition(
  diagnostics: MutableDatabaseDiagnostics | undefined,
  source: DatabasePoolSource,
  startedAt: number,
  failed: boolean,
): void {
  if (!diagnostics) return;
  const metrics = diagnostics[source];
  metrics.poolAcquisitions += 1;
  metrics.poolAcquireMs += Math.max(0, performance.now() - startedAt);
  if (failed) metrics.poolAcquireFailures += 1;
}

export async function measureDatabasePoolAcquisition<T>(
  source: DatabasePoolSource,
  acquire: () => Promise<T>,
): Promise<T> {
  const diagnostics = requestDatabaseDiagnostics.getStore();
  if (!diagnostics) return acquire();
  const startedAt = performance.now();
  try {
    const result = await acquire();
    recordPoolAcquisition(diagnostics, source, startedAt, false);
    return result;
  } catch (error) {
    recordPoolAcquisition(diagnostics, source, startedAt, true);
    throw error;
  }
}

function recordQuery(
  diagnostics: MutableDatabaseDiagnostics | undefined,
  source: DatabasePoolSource,
  startedAt: number,
  failed: boolean,
): void {
  if (!diagnostics) return;
  const metrics = diagnostics[source];
  const elapsed = Math.max(0, performance.now() - startedAt);
  metrics.queries += 1;
  metrics.queryRoundTripMs += elapsed;
  metrics.maxQueryRoundTripMs = Math.max(metrics.maxQueryRoundTripMs, elapsed);
  if (failed) metrics.queryFailures += 1;
}

export function instrumentDatabaseClient(client: PoolClient, source: DatabasePoolSource): PoolClient {
  if (instrumentedClients.has(client)) return client;
  instrumentedClients.add(client);

  const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
  Object.defineProperty(client, "query", {
    configurable: true,
    value: (...args: unknown[]) => {
      const diagnostics = requestDatabaseDiagnostics.getStore();
      if (!diagnostics) return originalQuery(...args);

      const startedAt = performance.now();
      let completed = false;
      const finish = (failed: boolean) => {
        if (completed) return;
        completed = true;
        recordQuery(diagnostics, source, startedAt, failed);
      };

      let callbackIndex = -1;
      for (let index = args.length - 1; index >= 0; index -= 1) {
        if (typeof args[index] === "function") {
          callbackIndex = index;
          break;
        }
      }
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (...callbackArgs: unknown[]) => unknown;
        args[callbackIndex] = function (this: unknown, ...callbackArgs: unknown[]) {
          finish(Boolean(callbackArgs[0]));
          return Reflect.apply(callback, this, callbackArgs);
        };
      }

      try {
        const result = originalQuery(...args);
        if (callbackIndex >= 0) return result;
        if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
          return Promise.resolve(result).then(
            (value) => {
              finish(false);
              return value;
            },
            (error: unknown) => {
              finish(true);
              throw error;
            },
          );
        }
        return result;
      } catch (error) {
        finish(true);
        throw error;
      }
    },
  });
  return client;
}

/** Track only aggregate pool and query timing; never capture SQL or values. */
export function instrumentDatabasePool(pool: Pool, source: DatabasePoolSource): Pool {
  if (instrumentedPools.has(pool)) return pool;
  instrumentedPools.add(pool);

  const originalConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  Object.defineProperty(pool, "connect", {
    configurable: true,
    value: (...args: unknown[]) => {
      const diagnostics = requestDatabaseDiagnostics.getStore();
      const startedAt = diagnostics ? performance.now() : 0;
      let callbackIndex = -1;
      for (let index = args.length - 1; index >= 0; index -= 1) {
        if (typeof args[index] === "function") {
          callbackIndex = index;
          break;
        }
      }

      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (...callbackArgs: unknown[]) => unknown;
        args[callbackIndex] = function (this: unknown, ...callbackArgs: unknown[]) {
          const failed = Boolean(callbackArgs[0]);
          if (diagnostics) recordPoolAcquisition(diagnostics, source, startedAt, failed);
          if (!failed && callbackArgs[1] && typeof callbackArgs[1] === "object") {
            instrumentDatabaseClient(callbackArgs[1] as PoolClient, source);
          }
          return Reflect.apply(callback, this, callbackArgs);
        };
        try {
          return originalConnect(...args);
        } catch (error) {
          if (diagnostics) recordPoolAcquisition(diagnostics, source, startedAt, true);
          throw error;
        }
      }

      try {
        return Promise.resolve(originalConnect(...args) as PoolClient).then(
          (client) => {
            if (diagnostics) recordPoolAcquisition(diagnostics, source, startedAt, false);
            return instrumentDatabaseClient(client as PoolClient, source);
          },
          (error: unknown) => {
            if (diagnostics) recordPoolAcquisition(diagnostics, source, startedAt, true);
            throw error;
          },
        );
      } catch (error) {
        if (diagnostics) recordPoolAcquisition(diagnostics, source, startedAt, true);
        throw error;
      }
    },
  });
  return pool;
}
