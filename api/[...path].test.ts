import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createVercelConfig } from "../web/vercel-config";

const environmentKeys = [
  "NOVA_BACKGROUND_SCHEDULER",
  "CRON_SECRET",
  "NOVA_BACKGROUND_JOB_SECRET",
  "DATABASE_URL",
  "NOVA_TRUST_PROXY_HEADERS",
] as const;
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of environmentKeys) {
    const previous = previousEnvironment.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

function cronRequest(headers?: HeadersInit): Request {
  return new Request("https://nova.example/api/internal/background/tick", {
    method: "GET",
    headers,
  });
}

async function vercelAdapter(): Promise<typeof import("./[...path]").default> {
  return (await import("./[...path]")).default;
}

test("each runtime exposes the app's root-relative assets from the shared web directory", async () => {
  const [configSource, appHtml, inviteHtml, resetHtml, appModule, adminReadModule, netlifyConfig, workerConfig, dockerfile, serverEntry] = await Promise.all([
    readFile(new URL("../vercel.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/accept-invite/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/reset-password/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/app.js", import.meta.url), "utf8"),
    readFile(new URL("../web/admin-read-state.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/wrangler.toml", import.meta.url), "utf8"),
    readFile(new URL("../docker/Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../server/src/index.ts", import.meta.url), "utf8"),
  ]);
  const rewrites = createVercelConfig("vercel").rewrites;
  for (const [source, destination] of [
    ["/app.js", "/web/app.js"],
    ["/admin-read-state.js", "/web/admin-read-state.js"],
    ["/role-grants.js", "/web/role-grants.js"],
    ["/styles.css", "/web/styles.css"],
  ]) {
    expect(rewrites).toContainEqual({ source, destination });
  }
  expect(configSource).toContain("createVercelConfig(process.env.NOVA_BACKGROUND_SCHEDULER)");
  expect(createVercelConfig("vercel").crons).toHaveLength(1);
  expect(createVercelConfig("supabase").crons).toHaveLength(0);
  for (const html of [appHtml, inviteHtml, resetHtml]) {
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain('src="/app.js"');
  }
  expect(appModule).toContain('from "./role-grants.js"');
  expect(appModule).toContain('from "./admin-read-state.js"');
  expect(adminReadModule).toContain("adminReadIssue");
  expect(rewrites.at(-1)?.destination).toBe("/web/index.html");
  expect(netlifyConfig).toContain('publish = "web"');
  expect(workerConfig).toContain('directory = "../web"');
  expect(dockerfile).toContain("COPY --from=build /app/web ./web");
  expect(serverEntry).toContain('new URL("../../web/", import.meta.url)');
});

test("Vercel Cron is an inert no-op unless Vercel is the selected scheduler", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "supabase";
  const response = await (await vercelAdapter()).fetch(cronRequest());

  expect(response.status).toBe(204);
});

test("Vercel Cron rejects an absent or incorrect provider credential", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "vercel";
  process.env.CRON_SECRET = "expected-cron-secret";

  const adapter = await vercelAdapter();
  const absent = await adapter.fetch(cronRequest());
  const incorrect = await adapter.fetch(cronRequest({ authorization: "Bearer wrong" }));

  expect(absent.status).toBe(401);
  expect(incorrect.status).toBe(401);
});

test("Vercel Cron fails closed when the NOVA tick credential is missing", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "vercel";
  process.env.CRON_SECRET = "expected-cron-secret";
  delete process.env.NOVA_BACKGROUND_JOB_SECRET;

  const response = await (await vercelAdapter()).fetch(
    cronRequest({ authorization: "Bearer expected-cron-secret" }),
  );

  expect(response.status).toBe(503);
  expect(await response.text()).toContain("scheduler is not configured");
});

test("authenticated Vercel Cron is translated to NOVA's protected POST contract", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "vercel";
  process.env.CRON_SECRET = "expected-cron-secret";
  process.env.NOVA_BACKGROUND_JOB_SECRET = "nova-tick-secret";
  delete process.env.DATABASE_URL;

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await (await vercelAdapter()).fetch(
      cronRequest({ authorization: "Bearer expected-cron-secret" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "BACKGROUND_JOB_FAILED" });
  } finally {
    console.error = originalConsoleError;
  }
});
