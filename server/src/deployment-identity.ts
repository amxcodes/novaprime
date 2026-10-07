import { createHash, timingSafeEqual } from "node:crypto";

const runtimeAdapters = new Set(["netlify", "cloudflare", "vercel", "vps"]);
const projectRefPattern = /^[a-z0-9]{20}$/;
const shaPattern = /^(?:[a-f0-9]{7,64})$/i;
const runtimeIdPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const schedulers = ["cloudflare", "netlify", "vercel", "supabase", "vps"] as const;
type DeploymentScheduler = typeof schedulers[number];

export interface DeploymentDatabaseState {
  schemaReady: boolean;
  migrationLedgerPresent: boolean;
}

export interface DeploymentIdentityDependencies {
  environment?: NodeJS.ProcessEnv;
  readDatabaseState?: () => Promise<DeploymentDatabaseState>;
  scheduler?: () => DeploymentScheduler | null;
}

export function databaseIdentityFingerprint(connectionString: string, projectRef?: string): string | null {
  try {
    const url = new URL(connectionString);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) return null;
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!databaseName) return null;
    const directRef = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname)?.[1]?.toLowerCase();
    const poolerRef = url.hostname.toLowerCase().endsWith(".pooler.supabase.com")
      ? decodeURIComponent(url.username).toLowerCase().split(".").at(-1)
      : undefined;
    if ((projectRef && directRef && projectRef !== directRef) ||
        (projectRef && poolerRef && projectRef !== poolerRef)) return null;
    const verifiedRef = projectRefPattern.test(projectRef ?? "")
      ? projectRef
      : directRef ?? (poolerRef && projectRefPattern.test(poolerRef) ? poolerRef : undefined);
    const canonical = verifiedRef
      ? JSON.stringify({ provider: "supabase", projectRef: verifiedRef, databaseName })
      : JSON.stringify({
          provider: "postgresql",
          hostname: url.hostname.toLowerCase(),
          port: url.port || "5432",
          databaseName,
        });
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  } catch {
    return null;
  }
}

function runtimeAdapter(environment: NodeJS.ProcessEnv): string | null {
  const configured = environment.NOVA_RUNTIME_ADAPTER?.toLowerCase();
  if (configured && runtimeAdapters.has(configured)) return configured;
  if (environment.NETLIFY === "true") return "netlify";
  if (environment.VERCEL === "1") return "vercel";
  return null;
}

function releaseSha(environment: NodeJS.ProcessEnv): string | null {
  const value = environment.NOVA_RELEASE_SHA ?? environment.COMMIT_REF ?? environment.VERCEL_GIT_COMMIT_SHA;
  return value && shaPattern.test(value) ? value.toLowerCase() : null;
}

function runtimeId(environment: NodeJS.ProcessEnv): string | null {
  const value = environment.NOVA_RUNTIME_ID ?? environment.NETLIFY_DEPLOY_ID ?? environment.VERCEL_URL;
  return value && runtimeIdPattern.test(value) ? value : null;
}

function configuredScheduler(environment: NodeJS.ProcessEnv): DeploymentScheduler | null {
  return schedulers.find((scheduler) => scheduler === environment.NOVA_BACKGROUND_SCHEDULER) ?? null;
}

function matchesSecret(expected: string, supplied: string | null): boolean {
  if (!supplied) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

async function readDatabaseState(): Promise<DeploymentDatabaseState> {
  const { database } = await import("./db.js");
  const result = await database().query<{
    schema_ready: boolean;
    migration_ledger_present: boolean;
  }>(
    [
      "SELECT to_regclass('nova.people') IS NOT NULL",
      "AND to_regclass('nova_auth.\"rateLimit\"') IS NOT NULL AS schema_ready,",
      "to_regclass('public.nova_schema_migrations') IS NOT NULL AS migration_ledger_present",
    ].join(" "),
  );
  const row = result.rows[0];
  if (!row || typeof row.schema_ready !== "boolean" || typeof row.migration_ledger_present !== "boolean") {
    throw new Error("DEPLOYMENT_IDENTITY_DATABASE_RESPONSE_INVALID");
  }
  return { schemaReady: row.schema_ready, migrationLedgerPresent: row.migration_ledger_present };
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Read-only identity endpoint; app role access remains limited to readiness catalogs. */
export function createDeploymentIdentityHandler(
  dependencies: DeploymentIdentityDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const environment = dependencies.environment ?? process.env;
    const expectedSecret = environment.NOVA_BACKGROUND_JOB_SECRET;
    if (!expectedSecret) return response({ error: "DEPLOYMENT_IDENTITY_NOT_CONFIGURED" }, 503);
    const authorization = request.headers.get("authorization");
    const token = authorization ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? null : null;
    if (!matchesSecret(expectedSecret, token)) {
      return response({ error: "DEPLOYMENT_IDENTITY_UNAUTHORIZED" }, 401);
    }

    const fingerprint = environment.DATABASE_URL
      ? databaseIdentityFingerprint(environment.DATABASE_URL, environment.NOVA_SUPABASE_PROJECT_REF)
      : null;
    if (!fingerprint) return response({ error: "DEPLOYMENT_IDENTITY_NOT_CONFIGURED" }, 503);
    try {
      const state = await (dependencies.readDatabaseState ?? readDatabaseState)();
      return response({
        service: "nova-api",
        status: "identified",
        runtime: {
          adapter: runtimeAdapter(environment),
          id: runtimeId(environment),
          releaseSha: releaseSha(environment),
        },
        database: {
          fingerprint,
          schemaReady: state.schemaReady,
          migrationLedgerPresent: state.migrationLedgerPresent,
        },
        scheduler: (dependencies.scheduler ?? (() => configuredScheduler(environment)))(),
      });
    } catch {
      return response({ error: "DEPLOYMENT_IDENTITY_DATABASE_UNAVAILABLE" }, 503);
    }
  };
}

export const deploymentIdentityHandler = createDeploymentIdentityHandler();
