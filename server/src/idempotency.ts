import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabaseRequestContext } from "./db.js";

export type IdempotencyResult<T> = T | Readonly<{
  __idempotency: "replay";
  body: unknown;
  status: number;
}> | "IDEMPOTENCY_KEY_REUSED";

export function requestIdempotencyKey(request: Request): string | "INVALID" | undefined {
  const value = request.headers.get("idempotency-key");
  if (value === null) return undefined;
  const key = value.trim();
  return key && key.length <= 200 ? key : "INVALID";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export async function idempotent<T>(
  transaction: PoolClient,
  context: DatabaseRequestContext,
  command: string,
  key: string | undefined,
  payload: unknown,
  operation: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  if (!key) return operation();
  const scope = `${context.organisationId}:${context.userId}:${command}:${key}`;
  await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scope]);
  const hash = requestFingerprint(payload);
  const existing = await transaction.query<{
    request_hash: string;
    response_status: number;
    response_body: unknown;
  }>(
    `SELECT request_hash, response_status, response_body
     FROM nova.api_idempotency_keys
     WHERE organisation_id = $1 AND actor_person_id = $2 AND command = $3
       AND idempotency_key = $4 AND expires_at > clock_timestamp()`,
    [context.organisationId, context.userId, command, key],
  );
  const row = existing.rows[0];
  if (row) {
    return row.request_hash === hash
      ? { __idempotency: "replay", body: row.response_body, status: row.response_status }
      : "IDEMPOTENCY_KEY_REUSED";
  }
  await transaction.query(
    `DELETE FROM nova.api_idempotency_keys
     WHERE organisation_id = $1 AND actor_person_id = $2 AND command = $3
       AND idempotency_key = $4 AND expires_at <= clock_timestamp()`,
    [context.organisationId, context.userId, command, key],
  );

  const result = await operation();
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    await transaction.query(
      `INSERT INTO nova.api_idempotency_keys (
         organisation_id, actor_person_id, command, idempotency_key,
         request_hash, response_status, response_body
       ) VALUES ($1, $2, $3, $4, $5, 201, $6::jsonb)`,
      [context.organisationId, context.userId, command, key, hash, JSON.stringify(result)],
    );
  }
  return result;
}

export function isIdempotencyReplay(value: unknown): value is { __idempotency: "replay"; body: unknown; status: number } {
  return typeof value === "object" && value !== null &&
    (value as { __idempotency?: unknown }).__idempotency === "replay";
}
