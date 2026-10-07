/*
 * Cloudflare adapter for the portable NOVA API.
 *
 * The domain handler remains server/src/app.ts. This adapter only supplies
 * deployment bindings (Hyperdrive, secrets, and static assets) and invokes
 * the same protected background tick from Cron Triggers.
 */
import { withRequestScopedDatabase } from "../server/src/db";

type AssetBinding = Readonly<{ fetch: (request: Request) => Promise<Response> }>;
type HyperdriveBinding = Readonly<{ connectionString: string }>;

type CloudflareEnvironment = Readonly<{
  ASSETS?: AssetBinding;
  HYPERDRIVE: HyperdriveBinding;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  NOVA_ALLOWED_ORIGINS?: string;
  NOVA_BACKGROUND_JOB_SECRET: string;
  NOVA_BACKGROUND_SCHEDULER: string;
  NOVA_BOOTSTRAP_TOKEN: string;
  NOVA_PUBLIC_ORIGIN?: string;
  NOVA_RELEASE_SHA?: string;
  NOVA_RUNTIME_ID?: string;
  NOVA_SECRETS_ENCRYPTION_KEY: string;
  NOVA_TRUST_PROXY_HEADERS?: string;
}>;

type NovaHandler = (request: Request) => Promise<Response>;
type ScheduledEvent = unknown;
type WorkerExecutionContext = Readonly<{ waitUntil: (promise: Promise<unknown>) => void }>;
let loadedHandler: NovaHandler | undefined;

function hyperdriveConnectionString(environment: CloudflareEnvironment): string {
  const connectionString = environment.HYPERDRIVE?.connectionString;
  if (!connectionString) throw new Error("HYPERDRIVE_BINDING_REQUIRED");
  return connectionString;
}

function configureNodeEnvironment(environment: CloudflareEnvironment): void {
  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  if (!processLike?.env) throw new Error("CLOUDFLARE_NODE_COMPATIBILITY_REQUIRED");
  const databaseUrl = hyperdriveConnectionString(environment);
  Object.assign(processLike.env, {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: environment.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: environment.BETTER_AUTH_URL,
    NOVA_ALLOWED_ORIGINS: environment.NOVA_ALLOWED_ORIGINS ?? environment.BETTER_AUTH_URL,
    NOVA_BACKGROUND_JOB_SECRET: environment.NOVA_BACKGROUND_JOB_SECRET,
    NOVA_BACKGROUND_SCHEDULER: environment.NOVA_BACKGROUND_SCHEDULER,
    NOVA_BOOTSTRAP_TOKEN: environment.NOVA_BOOTSTRAP_TOKEN,
    NOVA_DATABASE_REQUEST_SCOPED: "true",
    NOVA_RUNTIME_ADAPTER: "cloudflare",
    ...(environment.NOVA_RELEASE_SHA ? { NOVA_RELEASE_SHA: environment.NOVA_RELEASE_SHA } : {}),
    ...(environment.NOVA_RUNTIME_ID ? { NOVA_RUNTIME_ID: environment.NOVA_RUNTIME_ID } : {}),
    NOVA_SECRETS_ENCRYPTION_KEY: environment.NOVA_SECRETS_ENCRYPTION_KEY,
    // Cloudflare supplies cf-connecting-ip at the trusted edge. Direct/VPS
    // deployments leave this opt-in disabled unless their proxy is hardened.
    NOVA_TRUST_PROXY_HEADERS: environment.NOVA_TRUST_PROXY_HEADERS ?? "true",
    NOVA_EMAIL_RUNTIME: "https",
    NOVA_SERVE_WEB: "false",
  });
}

async function novaHandler(environment: CloudflareEnvironment): Promise<NovaHandler> {
  configureNodeEnvironment(environment);
  return (loadedHandler ??= (await import("../server/src/app")).handleRequest);
}

async function runScheduledTick(environment: CloudflareEnvironment): Promise<void> {
  if (environment.NOVA_BACKGROUND_SCHEDULER !== "cloudflare") return;
  const handler = await novaHandler(environment);
  const origin = environment.NOVA_PUBLIC_ORIGIN ?? environment.BETTER_AUTH_URL;
  const response = await handler(new Request(`${origin}/api/internal/background/tick`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${environment.NOVA_BACKGROUND_JOB_SECRET}`,
      "x-nova-background-scheduler": "cloudflare",
      "content-type": "application/json",
    },
  }));
  if (!response.ok) {
    console.error(`[NOVA Cloudflare] background tick failed with HTTP ${response.status}`);
    throw new Error(`BACKGROUND_TICK_HTTP_${response.status}`);
  } else {
    console.info(`[NOVA Cloudflare] background tick completed with HTTP ${response.status}`);
  }
}

export default {
  async fetch(request: Request, environment: CloudflareEnvironment): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return withRequestScopedDatabase(hyperdriveConnectionString(environment), async () => {
        const handler = await novaHandler(environment);
        return handler(request);
      });
    }
    if (environment.ASSETS) return environment.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    _event: ScheduledEvent,
    environment: CloudflareEnvironment,
    execution: WorkerExecutionContext,
  ): Promise<void> {
    execution.waitUntil(withRequestScopedDatabase(
      hyperdriveConnectionString(environment),
      () => runScheduledTick(environment),
    ));
  },
};
