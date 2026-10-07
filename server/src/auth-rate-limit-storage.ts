import { randomUUID } from "node:crypto";

type Query = (
  statement: string,
  parameters: readonly (string | number)[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

type Rule = Readonly<{ window: number; max: number }>;

// Better Auth 1.7.5's longest built-in sensitive-route window is 60 seconds.
// Keep this aligned if longer plugin or custom rules are introduced.
const longestBuiltInWindowMs = 60_000;

const consumeSql = `
  WITH clock AS MATERIALIZED (
    SELECT (extract(epoch FROM statement_timestamp()) * 1000)::bigint AS now_ms
  ), previous AS MATERIALIZED (
    SELECT "lastRequest"
    FROM nova_auth."rateLimit"
    WHERE key = $2
  ), consumed AS (
    INSERT INTO nova_auth."rateLimit" AS current_rate_limit
      (id, key, count, "lastRequest")
    SELECT $1, $2, 1, clock.now_ms FROM clock WHERE true
    ON CONFLICT (key) DO UPDATE
      SET count = CASE
            WHEN EXCLUDED."lastRequest" - current_rate_limit."lastRequest" >= $3::numeric
              THEN 1
            ELSE current_rate_limit.count + 1
          END,
          "lastRequest" = GREATEST(EXCLUDED."lastRequest", current_rate_limit."lastRequest")
      WHERE EXCLUDED."lastRequest" - current_rate_limit."lastRequest" >= $3::numeric
         OR current_rate_limit.count < $4
    RETURNING count
  )
  SELECT consumed.count,
         EXISTS (
           SELECT 1 FROM previous
           CROSS JOIN clock
           WHERE clock.now_ms - previous."lastRequest" >= $3::numeric
         ) AS should_prune
  FROM consumed`;

const denialSql = `
  WITH clock AS MATERIALIZED (
    SELECT (extract(epoch FROM statement_timestamp()) * 1000)::bigint AS now_ms
  )
  SELECT rate_limit."lastRequest" AS last_request,
         clock.now_ms,
         clock.now_ms - rate_limit."lastRequest" >= $2::numeric AS expired,
         GREATEST(
           1,
           ceil((rate_limit."lastRequest" + $2::numeric - clock.now_ms)::numeric / 1000)
         )::integer AS retry_after
  FROM nova_auth."rateLimit" AS rate_limit
  CROSS JOIN clock
  WHERE rate_limit.key = $1`;

export function createDatabaseAuthRateLimitStorage(query: Query) {
  return {
    async consume(key: string, rule: Rule): Promise<{ allowed: boolean; retryAfter: number | null }> {
      if (!Number.isFinite(rule.window) || rule.window <= 0
        || !Number.isSafeInteger(rule.max) || rule.max < 1) {
        throw new Error("AUTH_RATE_LIMIT_RULE_INVALID");
      }

      const windowMs = rule.window * 1000;
      if (!Number.isFinite(windowMs) || windowMs > Number.MAX_SAFE_INTEGER) {
        throw new Error("AUTH_RATE_LIMIT_RULE_INVALID");
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const consumed = await query(consumeSql, [randomUUID(), key, windowMs, rule.max]);
        const row = consumed.rows[0];
        if (row) {
          if (row.should_prune === true) {
            await query(
              `DELETE FROM nova_auth."rateLimit"
               WHERE "lastRequest" <
                 (extract(epoch FROM statement_timestamp()) * 1000)::bigint - $1`,
              [longestBuiltInWindowMs],
            );
          }
          return { allowed: true, retryAfter: null };
        }

        const denied = await query(denialSql, [key, windowMs]);
        const current = denied.rows[0];
        // A window can expire, or its row can be pruned, between the atomic
        // upsert and this fresh-snapshot read. Retry the atomic decision.
        if (!current || current.expired === true) continue;

        const retryAfter = Number(current.retry_after);
        if (!Number.isSafeInteger(retryAfter) || retryAfter < 1) {
          throw new Error("AUTH_RATE_LIMIT_RETRY_INVALID");
        }
        return { allowed: false, retryAfter };
      }

      throw new Error("AUTH_RATE_LIMIT_CONTENTION");
    },
  };
}
