import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import worker, { configureCloudflareRuntimeEnvironment } from "./worker";

const environmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CF_VERSION_METADATA",
  "NOVA_ALLOWED_ORIGINS",
  "NOVA_RELEASE_SHA",
  "NOVA_RUNTIME_ID",
  "NOVA_RUNTIME_ADAPTER",
  "NOVA_BACKGROUND_JOB_SECRET",
  "NOVA_BACKGROUND_SCHEDULER",
  "NOVA_BOOTSTRAP_TOKEN",
  "NOVA_DATABASE_REQUEST_SCOPED",
  "NOVA_SECRETS_ENCRYPTION_KEY",
  "NOVA_TRUST_PROXY_HEADERS",
  "NOVA_EMAIL_RUNTIME",
  "NOVA_SERVE_WEB",
] as const;
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

test("both Cloudflare scheduler configs build and serve the same Vite asset graph", () => {
  for (const file of ["./wrangler.toml", "./wrangler.supabase-cron.toml"]) {
    const configuration = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(configuration).toContain('command = "bun run build:web"');
    expect(configuration).toContain('directory = "../web/dist"');
    expect(configuration).toContain('run_worker_first = ["/api/*"]');
  }

  const supabaseCron = readFileSync(new URL("./wrangler.supabase-cron.toml", import.meta.url), "utf8");
  expect(supabaseCron).toContain('NOVA_BACKGROUND_SCHEDULER = "supabase"');
  expect(supabaseCron).toContain("crons = []");
  for (const file of ["./wrangler.toml", "./wrangler.supabase-cron.toml"]) {
    expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain('binding = "CF_VERSION_METADATA"');
  }
});

test("Cloudflare runtime identity uses the immutable Worker version id and a commit tag", () => {
  const versionId = "01234567-89ab-4cde-8fab-0123456789ab";
  const releaseSha = "A".repeat(40);
  configureCloudflareRuntimeEnvironment({
    HYPERDRIVE: { connectionString: "postgresql://nova_app:placeholder@127.0.0.1:1/nova" },
    BETTER_AUTH_SECRET: "not-used",
    BETTER_AUTH_URL: "https://nova.example",
    NOVA_BACKGROUND_JOB_SECRET: "not-used",
    NOVA_BACKGROUND_SCHEDULER: "supabase",
    NOVA_BOOTSTRAP_TOKEN: "not-used",
    NOVA_SECRETS_ENCRYPTION_KEY: "not-used",
    NOVA_RELEASE_SHA: "b".repeat(40),
    NOVA_RUNTIME_ID: "manually-configured-id",
    CF_VERSION_METADATA: { id: versionId, tag: releaseSha, timestamp: "2026-10-08T00:00:00Z" },
  });

  expect(process.env.NOVA_RUNTIME_ID).toBe(versionId);
  expect(process.env.NOVA_RELEASE_SHA).toBe(releaseSha.toLowerCase());

  configureCloudflareRuntimeEnvironment({
    HYPERDRIVE: { connectionString: "postgresql://nova_app:placeholder@127.0.0.1:1/nova" },
    BETTER_AUTH_SECRET: "not-used",
    BETTER_AUTH_URL: "https://nova.example",
    NOVA_BACKGROUND_JOB_SECRET: "not-used",
    NOVA_BACKGROUND_SCHEDULER: "supabase",
    NOVA_BOOTSTRAP_TOKEN: "not-used",
    NOVA_SECRETS_ENCRYPTION_KEY: "not-used",
    NOVA_RELEASE_SHA: "b".repeat(40),
    CF_VERSION_METADATA: { id: versionId, tag: "a".repeat(7) },
  });
  expect(process.env.NOVA_RUNTIME_ID).toBe(versionId);
  expect(process.env.NOVA_RELEASE_SHA).toBeUndefined();
});

afterEach(() => {
  for (const key of environmentKeys) {
    const previous = previousEnvironment.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

function environment(scheduler: string, tickSecret = "tick-secret") {
  return {
    HYPERDRIVE: {
      connectionString: "postgresql://nova_app:placeholder@127.0.0.1:1/nova",
    },
    BETTER_AUTH_SECRET: "a-local-test-only-secret-that-is-not-used-for-login",
    BETTER_AUTH_URL: "https://nova.example",
    NOVA_BACKGROUND_JOB_SECRET: tickSecret,
    NOVA_BACKGROUND_SCHEDULER: scheduler,
    NOVA_BOOTSTRAP_TOKEN: "not-used-in-health-test",
    NOVA_SECRETS_ENCRYPTION_KEY: "not-used-in-health-test",
  };
}

test("Cloudflare Worker forwards API health to NOVA's shared request handler", async () => {
  const response = await worker.fetch(
    new Request("https://nova.example/api/health"),
    environment("cloudflare"),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ service: "nova-api", status: "ok" });
});

test("Cloudflare Worker fails closed when Hyperdrive is missing", async () => {
  process.env.DATABASE_URL = "postgresql://nova_app:legacy-fallback@127.0.0.1:1/nova";
  const { HYPERDRIVE: _missingBinding, ...withoutHyperdrive } = environment("cloudflare");

  await expect(worker.fetch(
    new Request("https://nova.example/api/health"),
    withoutHyperdrive as unknown as Parameters<typeof worker.fetch>[1],
  )).rejects.toThrow("HYPERDRIVE_BINDING_REQUIRED");
});

test("Cloudflare Cron is inert when another scheduler is selected", async () => {
  let scheduledWork: Promise<unknown> | undefined;
  await worker.scheduled({}, environment("supabase"), {
    waitUntil(promise) {
      scheduledWork = promise;
    },
  });
  await scheduledWork;

  expect(scheduledWork).toBeDefined();
});

test("selected Cloudflare Cron reaches the common protected tick contract", async () => {
  let scheduledWork: Promise<unknown> | undefined;
  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => errors.push(values);
  try {
    await worker.scheduled({}, environment("cloudflare", ""), {
      waitUntil(promise) {
        scheduledWork = promise;
      },
    });
    expect(scheduledWork).toBeDefined();
    await expect(scheduledWork).rejects.toThrow("BACKGROUND_TICK_HTTP_401");
  } finally {
    console.error = originalConsoleError;
  }

  expect(errors).toHaveLength(1);
  expect(String(errors[0]?.[0])).toContain("background tick failed with HTTP 401");
});
