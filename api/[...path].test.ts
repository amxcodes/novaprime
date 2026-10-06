import { afterEach, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createVercelConfig } from "../web/vercel-config";

// Cron route contract tests never connect to PostgreSQL; keep its import from
// pulling the locally junction-linked driver into this isolated test process.
mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));
mock.module("nodemailer", () => ({ default: { createTransport: () => ({}) } }));

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

test("each runtime publishes the generated Vite graph and preserves the shared API path", async () => {
  const [configSource, appHtml, inviteHtml, resetHtml, appModule, adminReadModule, roleEditorModule, adminPageRouteModule, netlifyConfig, workerConfig, dockerfile, serverEntry] = await Promise.all([
    readFile(new URL("../vercel.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/accept-invite/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/reset-password/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/app.js", import.meta.url), "utf8"),
    readFile(new URL("../web/admin-read-state.js", import.meta.url), "utf8"),
    readFile(new URL("../web/src/features/admin/roles/RolePermissionsEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/admin-page-route.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/wrangler.toml", import.meta.url), "utf8"),
    readFile(new URL("../docker/Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../server/src/index.ts", import.meta.url), "utf8"),
  ]);
  const rewrites = createVercelConfig("vercel").rewrites;
  expect(createVercelConfig("vercel").buildCommand).toBe("bun run build:web");
  const vercelHeaders = createVercelConfig("vercel").headers;
  for (const [source, destination] of [
    ["/app.js", "/web/app.js"],
    ["/admin-read-state.js", "/web/admin-read-state.js"],
    ["/role-grants.js", "/web/role-grants.js"],
    ["/deployment-guide.js", "/web/deployment-guide.js"],
    ["/workspace-destinations.js", "/web/workspace-destinations.js"],
    ["/review-actions.js", "/web/review-actions.js"],
    ["/ui-preferences.js", "/web/ui-preferences.js"],
  ]) {
    expect(rewrites).toContainEqual({ source, destination });
  }
  const appImports = [...appModule.matchAll(/from\s+["']\.\/([^"']+\.js)["']/g)]
    .map((match) => match[1])
    .filter((asset) => !asset.startsWith("src/"));
  for (const asset of appImports) {
    const routePrefix = asset.split("/")[0];
    const source = asset.includes("/") ? `/${routePrefix}/:path*` : `/${asset}`;
    const destination = asset.includes("/") ? `/web/${routePrefix}/:path*` : `/web/${asset}`;
    expect(rewrites).toContainEqual({ source, destination });
  }
  expect(configSource).toContain("createVercelConfig(process.env.NOVA_BACKGROUND_SCHEDULER)");
  expect(createVercelConfig("vercel").crons).toHaveLength(1);
  expect(createVercelConfig("supabase").crons).toHaveLength(0);
  for (const html of [appHtml, inviteHtml, resetHtml]) {
    expect(html).toMatch(/<html\b[^>]*\blang="en"/);
    expect(html).toContain('name="referrer" content="no-referrer"');
  }
  expect(appModule).toContain('import { createAdminPageRoute } from "./app/admin-page-route.js"');
  expect(adminPageRouteModule).toContain('import("../src/features/admin/roles/RolePermissionsSection.tsx")');
  expect(roleEditorModule).toContain('from "../../../../role-grants.js"');
  expect(appModule).toContain('from "./admin-read-state.js"');
  expect(adminReadModule).toContain("adminReadIssue");
  expect(rewrites.at(-1)?.destination).toBe("/web/dist/index.html");
  expect(rewrites).toContainEqual({ source: "/assets/:path*", destination: "/web/dist/assets/:path*" });
  expect(rewrites).toContainEqual({ source: "/accept-invite", destination: "/web/dist/accept-invite/index.html" });
  expect(rewrites).toContainEqual({ source: "/reset-password", destination: "/web/dist/reset-password/index.html" });
  expect(vercelHeaders).toContainEqual({
    source: "/assets/:path*",
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  });
  expect(netlifyConfig).toContain('publish = "web/dist"');
  expect(netlifyConfig).toContain('command = "bun run build:web"');
  expect(netlifyConfig).toContain('Cache-Control = "public, max-age=31536000, immutable"');
  expect(netlifyConfig).toContain('for = "/"');
  expect(workerConfig).toContain('directory = "../web/dist"');
  expect(workerConfig).toContain('command = "bun run build:web"');
  expect(workerConfig).toContain('run_worker_first = ["/api/*"]');
  expect(workerConfig).toContain('html_handling = "drop-trailing-slash"');
  expect(workerConfig).toContain('not_found_handling = "none"');
  expect(dockerfile).toContain("COPY --from=build /app/web ./web");
  expect(serverEntry).toContain('new URL("../../web/", import.meta.url)');
  expect(serverEntry).toContain('new URL("../../web/dist/", import.meta.url)');
  expect(serverEntry).toContain("font/woff2");
  expect(serverEntry).toContain("max-age=31536000, immutable");
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
