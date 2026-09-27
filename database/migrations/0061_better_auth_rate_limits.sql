-- Shared Better Auth rate-limit storage.
-- Better Auth owns this infrastructure table; NOVA's domain authorization and
-- PostgreSQL RLS remain separate. A shared table is required for consistent
-- throttling when the API runs on multiple serverless instances.

CREATE TABLE IF NOT EXISTS nova_auth."rateLimit" (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL CHECK (count >= 0),
  "lastRequest" bigint NOT NULL CHECK ("lastRequest" >= 0)
);

CREATE INDEX IF NOT EXISTS better_auth_rate_limit_last_request
  ON nova_auth."rateLimit" ("lastRequest");

-- The migration/bootstrap runner grants this infrastructure table only to the
-- configured application role. Never leave it available to PUBLIC.
REVOKE ALL ON TABLE nova_auth."rateLimit" FROM PUBLIC;
