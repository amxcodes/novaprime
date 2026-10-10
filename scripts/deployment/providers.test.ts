import { expect, test } from "bun:test";
import { discoverProviderResources, type ProviderFetcher } from "./providers.ts";

test("provider discovery requests only explicit target resources and returns metadata only", async () => {
  const requests: Array<{ url: string; token: string }> = [];
  const fetcher: ProviderFetcher = async (input, init) => {
    const url = String(input);
    const token = new Headers(init?.headers).get("authorization") ?? "";
    requests.push({ url, token });
    if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id", ssl_url: "https://nova.example" });
    if (url.includes("/sites/site-id/deploys")) return Response.json([{
      state: "ready", context: "production", published: true, commit_ref: "a".repeat(40), function_schedules: [],
    }]);
    if (url.endsWith("/projects/abcdefghijklmnopqrst")) return Response.json({ id: "id", database: { version: "17.4" } });
    if (url.endsWith("/projects/abcdefghijklmnopqrst/health")) return Response.json([{ status: "HEALTHY" }]);
    throw new Error("unexpected read");
  };
  const resources = await discoverProviderResources({
    NETLIFY_AUTH_TOKEN: "netlify-secret-must-not-leak",
    NETLIFY_SITE_ID: "site-id",
    SUPABASE_ACCESS_TOKEN: "supabase-secret-must-not-leak",
    NOVA_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  }, fetcher);
  expect(resources).toContainEqual(expect.objectContaining({ provider: "netlify", state: "identified", target: "site-id", origin: "https://nova.example" }));
  expect(resources).toContainEqual(expect.objectContaining({ provider: "supabase", state: "identified", target: "abcdefghijklmnopqrst", databaseVersion: "17.4" }));
  expect(resources.find(({ provider }) => provider === "cloudflare")?.state).toBe("not-configured");
  expect(requests.length).toBe(4);
  expect(JSON.stringify(resources)).not.toContain("secret-must-not-leak");
  expect(JSON.stringify(resources)).not.toContain("Authorization");
});

test("provider discovery requires explicit target IDs and sanitizes API failure bodies", async () => {
  const fetcher: ProviderFetcher = async () => new Response("token response should never be surfaced", { status: 403 });
  const missingTarget = await discoverProviderResources({ CLOUDFLARE_API_TOKEN: "test" }, fetcher);
  expect(missingTarget.find(({ provider }) => provider === "cloudflare")).toEqual({ provider: "cloudflare", state: "target-required" });
  const rejected = await discoverProviderResources({
    CLOUDFLARE_API_TOKEN: "test",
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    CLOUDFLARE_WORKER_NAME: "nova-api",
  }, fetcher);
  expect(rejected.find(({ provider }) => provider === "cloudflare")).toEqual({
    provider: "cloudflare", state: "unavailable", detail: "MISSING_READ_PERMISSION",
  });
  expect(JSON.stringify(rejected)).not.toContain("token response");
});

function cloudflareCandidateInventoryFetcher(options: {
  previewsEnabled?: boolean;
  appDestinations?: readonly unknown[];
  extraApplications?: readonly unknown[];
  policies?: readonly unknown[];
  denyApps?: boolean;
  denyPolicies?: boolean;
} = {}): ProviderFetcher {
  return async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page") ?? 1);
    const pageEnvelope = (result: readonly unknown[]) => Response.json({
      success: true, result, result_info: { page, total_pages: result.length ? 1 : 0 },
    });
    if (url.pathname.endsWith("/schedules")) return Response.json({ success: true, result: { schedules: [] } });
    if (url.pathname.endsWith("/settings")) return Response.json({ success: true, result: { bindings: [] } });
    if (url.pathname.endsWith("/workers/domains")) return pageEnvelope([]);
    if (url.pathname.endsWith("/workers/routes")) return pageEnvelope([]);
    if (url.pathname.endsWith("/workers/workers")) return pageEnvelope([{
      id: "worker-immutable-id", name: "nova-api",
    }]);
    if (url.pathname.endsWith("/scripts/nova-api/subdomain")) return Response.json({ success: true, result: {
      enabled: true, previews_enabled: options.previewsEnabled ?? true,
    } });
    if (url.pathname.endsWith("/workers/subdomain")) return Response.json({ success: true, result: { subdomain: "nova-team" } });
    if (url.pathname.endsWith("/access/apps")) {
      if (options.denyApps) return new Response("private access inventory response", { status: 403 });
      return pageEnvelope([{
        id: "access-app-id", type: "self_hosted", destinations: options.appDestinations ?? [{
          type: "preview_worker", worker_id: "worker-immutable-id", overrides: [],
        }],
      }, ...(options.extraApplications ?? [])]);
    }
    if (url.pathname.includes("/access/apps/") && url.pathname.endsWith("/policies")) {
      if (options.denyPolicies) return new Response("private policy inventory response", { status: 403 });
      return pageEnvelope(options.policies ?? [{
        decision: "allow", include: [{ email: { email: "operator@example.test" } }],
      }]);
    }
    if (url.pathname.endsWith("/access/apps/")) return pageEnvelope([]);
    if (url.pathname.endsWith("/scripts/nova-api")) return Response.json({ success: true, result: {
      id: "nova-api", modified_on: "2026-10-07T00:00:00Z",
    } });
    throw new Error("unexpected Cloudflare read: " + url.pathname);
  };
}

const cloudflareCandidateEnvironment = {
  CLOUDFLARE_API_TOKEN: "cloudflare-token",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_WORKER_NAME: "nova-api",
};

test("Cloudflare candidate inventory verifies the exact preview application and an identity-limited policy", async () => {
  const resources = await discoverProviderResources(cloudflareCandidateEnvironment, cloudflareCandidateInventoryFetcher());
  const cloudflare = resources.find(({ provider }) => provider === "cloudflare")!;
  expect(cloudflare).toMatchObject({
    runtimeId: "worker-immutable-id",
    candidateAccessProtection: {
      state: "verified", previewUrlsEnabled: true, workerScopedPolicy: "verified", publicDestinationOverrides: "none",
    },
  });
  expect(JSON.stringify(cloudflare)).not.toContain("operator@example.test");
});

test("Cloudflare candidate inventory fails closed for disabled previews, broad policies, and public overrides", async () => {
  const cases = [
    { options: { previewsEnabled: false }, expected: { previewUrlsEnabled: false } },
    { options: { policies: [{ decision: "allow", include: [{ everyone: {} }] }] }, expected: { workerScopedPolicy: "unsafe" } },
    { options: { policies: [{ decision: "allow", include: [{ email_domain: { domain: "example.test" } }] }] }, expected: { workerScopedPolicy: "unsafe" } },
    { options: { policies: [{ decision: "bypass", include: [{ email: { email: "operator@example.test" } }] }] }, expected: { workerScopedPolicy: "unsafe" } },
    { options: {
      extraApplications: [{
        id: "higher-priority-app", type: "self_hosted",
        destinations: [{ type: "public", uri: "https://*-nova-api.nova-team.workers.dev/*", overrides: [] }],
      }],
      policies: [{ decision: "allow", include: [{ everyone: {} }] }],
    }, expected: { workerScopedPolicy: "unsafe" } },
    { options: {
      extraApplications: [{
        id: "account-preview-app", type: "self_hosted",
        destinations: [{ type: "all_preview_workers", overrides: [] }],
      }],
      policies: [{ decision: "allow", include: [{ everyone: {} }] }],
    }, expected: { workerScopedPolicy: "unsafe" } },
    { options: { appDestinations: [{ type: "all_preview_workers", overrides: [{ behavior: "public", path_pattern: "/debug/*" }] }] }, expected: { publicDestinationOverrides: "present" } },
    { options: { appDestinations: [{ type: "public", uri: "https://*-nova-api.nova-team.workers.dev/*", overrides: [{ behavior: "public", path_pattern: "/*" }] }] }, expected: { publicDestinationOverrides: "present" } },
    { options: { appDestinations: [{ type: "public", uri: "https://v1-nova-api.nova-team.workers.dev/*", overrides: [] }] }, expected: { workerScopedPolicy: "unverified" } },
  ] as const;
  for (const { options, expected } of cases) {
    const resources = await discoverProviderResources(cloudflareCandidateEnvironment, cloudflareCandidateInventoryFetcher(options));
    const protection = resources.find(({ provider }) => provider === "cloudflare")?.candidateAccessProtection;
    expect(protection?.state).toBe("unavailable");
    expect(protection).toMatchObject(expected);
  }
});

test("Cloudflare candidate inventory verifies restrictive policies on a higher-priority public destination", async () => {
  const resources = await discoverProviderResources(cloudflareCandidateEnvironment, cloudflareCandidateInventoryFetcher({
    extraApplications: [{
      id: "higher-priority-app", type: "self_hosted",
      destinations: [{ type: "public", uri: "https://*-nova-api.nova-team.workers.dev/*", overrides: [] }],
    }],
  }));
  expect(resources.find(({ provider }) => provider === "cloudflare")?.candidateAccessProtection).toMatchObject({
    state: "verified", workerScopedPolicy: "verified", publicDestinationOverrides: "none",
  });
});

test("Cloudflare candidate inventory reports missing policy-read access and absent application separately", async () => {
  for (const options of [{ denyApps: true }, { denyPolicies: true }, { appDestinations: [] }]) {
    const resources = await discoverProviderResources(cloudflareCandidateEnvironment, cloudflareCandidateInventoryFetcher(options));
    const protection = resources.find(({ provider }) => provider === "cloudflare")?.candidateAccessProtection;
    expect(protection?.state).toBe("unavailable");
    expect(["missing", "unverified"].includes(protection?.workerScopedPolicy ?? "")).toBe(true);
    expect(JSON.stringify(protection)).not.toContain("private");
  }
});

test("Netlify Cron inventory comes only from its latest published production deploy", async () => {
  const requests: string[] = [];
  const fetcher: ProviderFetcher = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id", url: "nova.netlify.app" });
    if (url.includes("/sites/site-id/deploys")) return Response.json([{
      state: "ready", context: "production", published: true, commit_ref: "a".repeat(40),
      function_schedules: [{ name: "nova-background-tick", cron: "*/5 * * * *" }],
    }]);
    throw new Error("unexpected read");
  };
  const resources = await discoverProviderResources({ NETLIFY_AUTH_TOKEN: "netlify-token", NETLIFY_SITE_ID: "site-id" }, fetcher);
  expect(requests.some((url) => url.includes("production=true&latest-published=true&per_page=1"))).toBe(true);
  expect(resources.find(({ provider }) => provider === "netlify")?.schedulerInventory).toEqual({
    scope: "target-runtime",
    state: "verified",
    completeness: "project-scoped",
    triggers: [{ id: "nova-background-tick", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }],
  });
});

test("Netlify Cron inventory distinguishes an explicit empty schedule list from missing metadata", async () => {
  for (const [function_schedules, expected] of [
    [[], { state: "not-installed", completeness: "project-scoped" }],
    [undefined, { state: "unavailable", completeness: "partial", detail: "NETLIFY_PUBLISHED_DEPLOY_SCHEDULE_INVENTORY_UNAVAILABLE" }],
  ] as const) {
    const fetcher: ProviderFetcher = async (input) => {
      const url = String(input);
      if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id" });
      if (url.includes("/sites/site-id/deploys")) return Response.json([{
        state: "ready", context: "production", published: true, ...(function_schedules === undefined ? {} : { function_schedules }),
      }]);
      throw new Error("unexpected read");
    };
    const resources = await discoverProviderResources({ NETLIFY_AUTH_TOKEN: "netlify-token", NETLIFY_SITE_ID: "site-id" }, fetcher);
    expect(resources.find(({ provider }) => provider === "netlify")?.schedulerInventory).toMatchObject({
      scope: "target-runtime", triggers: [], ...expected,
    });
  }
});

test("Netlify inventory records production binding metadata and hostnames but never variable values", async () => {
  const variableValue = "postgresql://nova_app:never-retain-this@db.example.test/nova";
  const originValue = "https://do-not-retain-variable-value.example.test";
  const fetcher: ProviderFetcher = async (input) => {
    const url = String(input);
    if (url.endsWith("/sites/site-id")) return Response.json({
      id: "site-id", account_id: "team-id", ssl_url: "https://nova.example.test", url: "nova-site.netlify.app",
      custom_domain: "nova.example.test", domain_aliases: ["www.nova.example.test"],
    });
    if (url.includes("/sites/site-id/deploys")) return Response.json([{
      state: "ready", context: "production", published: true, commit_sha: "a".repeat(40), function_schedules: [],
    }]);
    if (url.includes("/accounts/team-id/env?")) {
      const scope = new URL(url).searchParams.get("scope");
      if (scope === "builds") return Response.json([
        { key: "NOVA_BACKGROUND_SCHEDULER", scopes: ["builds"], values: [{ context: "production", value: "supabase" }], is_secret: false },
        { key: "PRIVATE_BUILD_VALUE", scopes: ["builds"], values: [{ context: "production", value: variableValue }], is_secret: true },
      ]);
      return Response.json([
        { key: "DATABASE_URL", scopes: ["functions"], values: [{ context: "production", value: variableValue }], is_secret: true },
        { key: "BETTER_AUTH_URL", scopes: ["functions"], values: [{ context: "all", value: originValue }], is_secret: false },
        { key: "NOVA_BACKGROUND_SCHEDULER", scopes: ["functions"], values: [{ context: "production", value: "supabase" }], is_secret: false },
      ]);
    }
    throw new Error("unexpected read");
  };
  const resources = await discoverProviderResources({ NETLIFY_AUTH_TOKEN: "token", NETLIFY_SITE_ID: "site-id" }, fetcher);
  const netlify = resources.find(({ provider }) => provider === "netlify")!;
  expect(netlify.runtimeBindings).toMatchObject({
    state: "verified", completeness: "selected-runtime", configuredScheduler: "supabase",
    buildSchedulerAvailable: true, configuredBuildScheduler: "supabase",
    bindings: [
      { name: "BETTER_AUTH_URL", contexts: ["all"], scopes: ["functions"], secret: false },
      { name: "DATABASE_URL", contexts: ["production"], scopes: ["functions"], secret: true },
      { name: "NOVA_BACKGROUND_SCHEDULER", contexts: ["production"], scopes: ["functions"], secret: false },
    ],
  });
  expect(netlify.domainRoutes).toEqual({
    state: "verified", completeness: "selected-runtime", domains: [
      { hostname: "nova-site.netlify.app", source: "provider-default" },
      { hostname: "nova.example.test", source: "custom-domain" },
      { hostname: "www.nova.example.test", source: "custom-domain" },
    ],
  });
  expect(JSON.stringify(netlify)).not.toContain(variableValue);
  expect(JSON.stringify(netlify)).not.toContain(originValue);
});

test("Netlify inventory reads both production variable scopes and does not accept a missing build selector", async () => {
  const scopes: string[] = [];
  const fetcher: ProviderFetcher = async (input) => {
    const url = String(input);
    if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id", account_id: "team-id" });
    if (url.includes("/deploys")) return Response.json([{ state: "ready", context: "production", published: true, function_schedules: [] }]);
    if (url.includes("/env?")) {
      const scope = new URL(url).searchParams.get("scope") ?? "";
      scopes.push(scope);
      if (scope === "functions") return Response.json([
        { key: "NOVA_BACKGROUND_SCHEDULER", scopes: ["functions"], values: [{ context: "production", value: "netlify" }], is_secret: false },
      ]);
      return Response.json([]);
    }
    throw new Error("unexpected read");
  };
  const resources = await discoverProviderResources({ NETLIFY_AUTH_TOKEN: "token", NETLIFY_SITE_ID: "site-id" }, fetcher);
  const netlify = resources.find(({ provider }) => provider === "netlify")!;
  expect(scopes.sort()).toEqual(["builds", "functions"]);
  expect(netlify.runtimeBindings).toMatchObject({ state: "verified", configuredScheduler: "netlify", buildSchedulerAvailable: false });
  expect(netlify.runtimeBindings).not.toHaveProperty("configuredBuildScheduler");
});

test("Netlify build-scope permission failure leaves scheduler bindings unavailable", async () => {
  const fetcher: ProviderFetcher = async (input) => {
    const url = String(input);
    if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id", account_id: "team-id" });
    if (url.includes("/deploys")) return Response.json([{ state: "ready", context: "production", published: true, function_schedules: [] }]);
    if (url.includes("/env?")) {
      return new URL(url).searchParams.get("scope") === "builds"
        ? new Response("private permission response", { status: 403 })
        : Response.json([{ key: "NOVA_BACKGROUND_SCHEDULER", scopes: ["functions"], values: [{ context: "production", value: "netlify" }], is_secret: false }]);
    }
    throw new Error("unexpected read");
  };
  const resources = await discoverProviderResources({ NETLIFY_AUTH_TOKEN: "token", NETLIFY_SITE_ID: "site-id" }, fetcher);
  const netlify = resources.find(({ provider }) => provider === "netlify")!;
  expect(netlify.runtimeBindings).toMatchObject({ state: "unavailable", completeness: "partial", detail: "MISSING_READ_PERMISSION", bindings: [] });
  expect(JSON.stringify(netlify)).not.toContain("private permission response");
});

test("Netlify variable permission failure remains explicit without discarding site identity", async () => {
  const fetcher: ProviderFetcher = async (input) => {
    const url = String(input);
    if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id", account_id: "team-id", url: "nova-site.netlify.app", custom_domain: null, domain_aliases: [] });
    if (url.includes("/deploys")) return Response.json([{ state: "ready", context: "production", published: true, function_schedules: [] }]);
    if (url.includes("/env?")) return new Response("private error body", { status: 403 });
    throw new Error("unexpected read");
  };
  const resources = await discoverProviderResources({ NETLIFY_AUTH_TOKEN: "token", NETLIFY_SITE_ID: "site-id" }, fetcher);
  const netlify = resources.find(({ provider }) => provider === "netlify")!;
  expect(netlify.state).toBe("identified");
  expect(netlify.runtimeBindings).toMatchObject({ state: "unavailable", detail: "MISSING_READ_PERMISSION", bindings: [] });
  expect(JSON.stringify(netlify)).not.toContain("private error body");
});

test("Cloudflare inventory distinguishes one Worker's Cron triggers from global scheduler coverage", async () => {
  const requested: URL[] = [];
  const fetcher: ProviderFetcher = async (input) => {
    const parsed = new URL(String(input));
    requested.push(parsed);
    if (parsed.pathname.endsWith("/schedules")) {
      return Response.json({ success: true, result: { schedules: [{ cron: "*/5 * * * *" }] } });
    }
    if (parsed.pathname.endsWith("/settings")) return Response.json({ success: true, result: { bindings: [
      { name: "HYPERDRIVE", type: "hyperdrive", id: "hyperdrive-id" },
      { name: "CF_VERSION_METADATA", type: "version_metadata" },
      { name: "BETTER_AUTH_SECRET", type: "secret_text", text: "never-retain-secret-value" },
      { name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", text: "supabase" },
    ] } });
    if (parsed.pathname.endsWith("/hyperdrive/configs/hyperdrive-id")) return Response.json({
      success: true,
      result: {
        id: "hyperdrive-id",
        origin: { host: "db.abcdefghijklmnopqrst.supabase.co", database: "postgres", scheme: "postgresql", user: "nova_app", password: "never-retain-hyperdrive-password" },
      },
    });
    if (parsed.pathname.endsWith("/workers/domains")) {
      const page = Number(parsed.searchParams.get("page"));
      return Response.json({ success: true, result: [{
        hostname: `app${page}.example.test`, service: "nova-api", zone_id: "c".repeat(32), zone_name: "example.test", enabled: page === 1, secret_value: "omit-me",
      }], result_info: { page, total_pages: 2 } });
    }
    if (parsed.pathname.endsWith("/workers/routes")) return Response.json({
      success: true,
      result: [{ id: "route-id", pattern: "other.example.test/*", script: "other-worker" }],
      result_info: { page: 1, total_pages: 1 },
    });
    if (parsed.pathname.endsWith("/dns_records")) return Response.json({
      success: true,
      result: [{ name: parsed.searchParams.get("name"), type: "A", proxied: true, content: "never-retain-dns-target" }],
      result_info: { page: 1, total_pages: 1 },
    });
    return Response.json({ success: true, result: { id: "nova-api", modified_on: "2026-10-07T00:00:00Z" } });
  };
  const resources = await discoverProviderResources({
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_WORKER_NAME: "nova-api",
    DATABASE_URL: "postgresql://nova_app.abcdefghijklmnopqrst:runtime-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
    NOVA_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  }, fetcher);
  expect(resources.find(({ provider }) => provider === "cloudflare")?.schedulerInventory).toEqual({
    scope: "target-runtime",
    state: "verified",
    completeness: "resource-only",
    triggers: [{ id: "nova-api/schedule-1", name: "cloudflare-cron-trigger", schedule: "*/5 * * * *", active: true }],
  });
  const cloudflare = resources.find(({ provider }) => provider === "cloudflare")!;
  expect(cloudflare.runtimeBindings).toMatchObject({
    state: "verified", completeness: "selected-runtime", configuredScheduler: "supabase",
    hyperdrive: { configurationId: "hyperdrive-id", databaseTarget: "verified", runtimeRole: "verified" },
    bindings: [
      { name: "BETTER_AUTH_SECRET", type: "secret_text", secret: true },
      { name: "CF_VERSION_METADATA", type: "version_metadata", secret: false },
      { name: "HYPERDRIVE", type: "hyperdrive", secret: false },
      { name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", secret: false },
    ],
  });
  expect(cloudflare.domainRoutes).toEqual({
    state: "verified", completeness: "selected-runtime", domains: [
      { hostname: "app1.example.test", enabled: true, source: "custom-domain" },
      { hostname: "app2.example.test", enabled: false, source: "custom-domain" },
    ],
    cloudflareRouting: {
      state: "verified", completeness: "selected-runtime", zones: [{
        zoneId: "c".repeat(32), hostnames: ["app1.example.test", "app2.example.test"], state: "verified",
        routes: [{ pattern: "other.example.test/*", script: "other-worker" }],
        dnsRecords: [
          { hostname: "app1.example.test", type: "A", proxied: true },
          { hostname: "app2.example.test", type: "A", proxied: true },
        ],
      }],
    },
  });
  expect(JSON.stringify(cloudflare)).not.toContain("never-retain-secret-value");
  expect(JSON.stringify(cloudflare)).not.toContain("never-retain-hyperdrive-password");
  expect(JSON.stringify(cloudflare)).not.toContain("db.abcdefghijklmnopqrst.supabase.co");
  expect(JSON.stringify(cloudflare)).not.toContain("nova_app.abcdefghijklmnopqrst");
  expect(JSON.stringify(cloudflare)).not.toContain("runtime-password");
  expect(JSON.stringify(cloudflare)).not.toContain("omit-me");
  expect(JSON.stringify(cloudflare)).not.toContain("never-retain-dns-target");
  expect(requested.filter(({ pathname }) => pathname.endsWith("/workers/routes")).map(({ pathname, searchParams }) => ({
    pathname, page: searchParams.get("page"), zoneId: pathname.split("/").at(-3),
  }))).toEqual([{ pathname: `/client/v4/zones/${"c".repeat(32)}/workers/routes`, page: "1", zoneId: "c".repeat(32) }]);
  expect(requested.filter(({ pathname }) => pathname.endsWith("/dns_records")).map(({ searchParams }) => searchParams.get("name")).sort())
    .toEqual(["app1.example.test", "app2.example.test"]);
});

test("Cloudflare inventory verifies the Hyperdrive database and app role without retaining connection data", async () => {
  const projectRef = "abcdefghijklmnopqrst";
  const commonEnvironment = {
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_WORKER_NAME: "nova-api",
    DATABASE_URL: `postgresql://nova_app.${projectRef}:runtime-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    NOVA_SUPABASE_PROJECT_REF: projectRef,
  };
  const cases = [
    { name: "wrong project", origin: { host: `db.${"z".repeat(20)}.supabase.co`, database: "postgres", scheme: "postgres", port: 5432, user: "nova_app", password: "do-not-retain" }, expected: { databaseTarget: "mismatch", runtimeRole: "verified" } },
    { name: "owner role", origin: { host: `db.${projectRef}.supabase.co`, database: "postgres", scheme: "postgres", port: 5432, user: "postgres", password: "do-not-retain" }, expected: { databaseTarget: "verified", runtimeRole: "invalid" } },
    { name: "same direct PostgreSQL database", origin: { host: "db.example.test", database: "customer_private_db", scheme: "postgres", port: 5432, user: "nova_app", password: "do-not-retain" }, databaseUrl: "postgresql://nova_app:runtime-password@db.example.test:5432/customer_private_db", noProjectRef: true, expected: { databaseTarget: "verified", runtimeRole: "verified" } },
    { name: "missing selected database", origin: { host: `db.${projectRef}.supabase.co`, database: "postgres", scheme: "postgres", port: 5432, user: "nova_app", password: "do-not-retain" }, missingDatabaseUrl: true, expected: { databaseTarget: "unverified", runtimeRole: "unverified" } },
    { name: "missing Hyperdrive read permission", forbidden: true, expected: { databaseTarget: "unverified", runtimeRole: "unverified" } },
  ] as const;

  for (const scenario of cases) {
    const fetcher: ProviderFetcher = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/schedules")) return Response.json({ success: true, result: { schedules: [] } });
      if (url.pathname.endsWith("/settings")) return Response.json({ success: true, result: { bindings: [
        { name: "HYPERDRIVE", type: "hyperdrive", id: "hyperdrive-id" },
        { name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", text: "supabase" },
      ] } });
      if (url.pathname.endsWith("/hyperdrive/configs/hyperdrive-id")) {
        if ("forbidden" in scenario) return new Response("private provider response", { status: 403 });
        return Response.json({ success: true, result: { id: "hyperdrive-id", origin: scenario.origin } });
      }
      if (url.pathname.endsWith("/workers/domains")) return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 0 } });
      return Response.json({ success: true, result: { id: "nova-api", modified_on: "2026-10-07T00:00:00Z" } });
    };
    const environment: Record<string, string> = { ...commonEnvironment };
    if ("databaseUrl" in scenario) environment.DATABASE_URL = scenario.databaseUrl;
    if ("missingDatabaseUrl" in scenario) delete environment.DATABASE_URL;
    if ("noProjectRef" in scenario) delete environment.NOVA_SUPABASE_PROJECT_REF;
    const cloudflare = (await discoverProviderResources(environment, fetcher))
      .find(({ provider }) => provider === "cloudflare");
    expect(cloudflare?.runtimeBindings?.hyperdrive).toMatchObject({
      configurationId: "hyperdrive-id",
      ...scenario.expected,
    }, scenario.name);
    expect(JSON.stringify(cloudflare)).not.toContain("do-not-retain");
    expect(JSON.stringify(cloudflare)).not.toContain("runtime-password");
    expect(JSON.stringify(cloudflare)).not.toContain("private provider response");
    if ("origin" in scenario) {
      for (const value of [scenario.origin.host, scenario.origin.user, scenario.origin.database, scenario.origin.password]) {
        expect(JSON.stringify(cloudflare)).not.toContain(value);
      }
    }
  }
});

test("Cloudflare domain inventory fails closed when routability is omitted", async () => {
  const fetcher: ProviderFetcher = async (input) => {
    const parsed = new URL(String(input));
    if (parsed.pathname.endsWith("/schedules")) return Response.json({ success: true, result: { schedules: [] } });
    if (parsed.pathname.endsWith("/settings")) return Response.json({ success: true, result: { bindings: [] } });
    if (parsed.pathname.endsWith("/workers/domains")) return Response.json({
      success: true,
      result: [{ hostname: "nova.example.test", service: "nova-api", zone_id: "c".repeat(32) }],
      result_info: { page: 1, total_pages: 1 },
    });
    return Response.json({ success: true, result: { id: "nova-api" } });
  };
  const resources = await discoverProviderResources({
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_WORKER_NAME: "nova-api",
  }, fetcher);
  expect(resources.find(({ provider }) => provider === "cloudflare")?.domainRoutes).toMatchObject({
    state: "unavailable", completeness: "partial", detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID",
  });
});

test("Cloudflare route or DNS read permission failure leaves a partial domain inventory", async () => {
  const fetcher: ProviderFetcher = async (input) => {
    const parsed = new URL(String(input));
    if (parsed.pathname.endsWith("/schedules")) return Response.json({ success: true, result: { schedules: [] } });
    if (parsed.pathname.endsWith("/settings")) return Response.json({ success: true, result: { bindings: [] } });
    if (parsed.pathname.endsWith("/workers/domains")) return Response.json({
      success: true,
      result: [{ hostname: "nova.example.test", service: "nova-api", zone_id: "c".repeat(32), enabled: true }],
      result_info: { page: 1, total_pages: 1 },
    });
    if (parsed.pathname.endsWith("/workers/routes")) return new Response("private Cloudflare error", { status: 403 });
    if (parsed.pathname.endsWith("/dns_records")) throw new Error("route denial should stop the zone read");
    return Response.json({ success: true, result: { id: "nova-api" } });
  };
  const resources = await discoverProviderResources({
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_WORKER_NAME: "nova-api",
  }, fetcher);
  const cloudflare = resources.find(({ provider }) => provider === "cloudflare")!;
  expect(cloudflare.state).toBe("identified");
  expect(cloudflare.domainRoutes?.state).toBe("verified");
  expect(cloudflare.domainRoutes?.cloudflareRouting).toMatchObject({
    state: "unavailable", completeness: "partial", detail: "CLOUDFLARE_ROUTING_INVENTORY_INCOMPLETE",
    zones: [{ zoneId: "c".repeat(32), state: "unavailable", detail: "MISSING_READ_PERMISSION" }],
  });
  expect(JSON.stringify(cloudflare)).not.toContain("private Cloudflare error");
});

test("Cloudflare inventory treats an explicit zero-page domain response as verified empty", async () => {
  const fetcher: ProviderFetcher = async (input) => {
    const parsed = new URL(String(input));
    if (parsed.pathname.endsWith("/schedules")) return Response.json({ success: true, result: { schedules: [] } });
    if (parsed.pathname.endsWith("/settings")) return Response.json({ success: true, result: { bindings: [] } });
    if (parsed.pathname.endsWith("/workers/domains")) {
      return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 0 } });
    }
    return Response.json({ success: true, result: { id: "nova-api" } });
  };
  const resources = await discoverProviderResources({
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_WORKER_NAME: "nova-api",
  }, fetcher);
  expect(resources.find(({ provider }) => provider === "cloudflare")?.domainRoutes).toEqual({
    state: "verified", completeness: "selected-runtime", domains: [],
    cloudflareRouting: { state: "verified", completeness: "selected-runtime", zones: [] },
  });
});

test("live deployment identity sends its bearer only to the configured HTTPS origin and allowlists the result", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetcher: ProviderFetcher = async (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({
      service: "nova-api",
      status: "identified",
      runtime: { adapter: "netlify", id: "deploy-1", releaseSha: "a".repeat(40) },
      database: { fingerprint: "b".repeat(64), schemaReady: true, migrationLedgerPresent: true },
      scheduler: "supabase",
      futureSensitiveValue: "should never be retained",
    });
  };
  const secret = "identity-secret-must-not-leak";
  const resources = await discoverProviderResources({
    NOVA_PUBLIC_ORIGIN: "https://nova.example",
    NOVA_BACKGROUND_JOB_SECRET: secret,
  }, fetcher);
  expect(requests).toContainEqual({
    url: "https://nova.example/api/internal/deployment/identity",
    authorization: `Bearer ${secret}`,
  });
  expect(resources).toContainEqual(expect.objectContaining({
    provider: "nova",
    state: "identified",
    runtime: "netlify",
    runtimeId: "deploy-1",
    release: "a".repeat(40),
    databaseFingerprint: "b".repeat(64),
    schemaReady: true,
    configuredScheduler: "supabase",
  }));
  expect(JSON.stringify(resources)).not.toContain(secret);
  expect(JSON.stringify(resources)).not.toContain("should never be retained");
});

test("deployment plans can probe public readiness without sending the identity secret", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const secret = "identity-secret-must-not-reach-public-readiness";
  const fetcher: ProviderFetcher = async (input, init) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    return url.endsWith("/api/ready")
      ? Response.json({ service: "nova-api", status: "ready", scheduler: "supabase" })
      : Response.json({
        service: "nova-api", status: "identified",
        runtime: { adapter: "netlify", id: "deploy-1" },
        database: { fingerprint: "b".repeat(64), schemaReady: true, migrationLedgerPresent: true },
        scheduler: "supabase",
      });
  };
  const resources = await discoverProviderResources({
    NOVA_PUBLIC_ORIGIN: "https://nova.example",
    NOVA_BACKGROUND_JOB_SECRET: secret,
  }, fetcher, { probePublicReadiness: true });
  expect(requests).toContainEqual({
    url: "https://nova.example/api/internal/deployment/identity", authorization: `Bearer ${secret}`,
  });
  expect(requests).toContainEqual({ url: "https://nova.example/api/ready", authorization: null });
  expect(resources.find(({ provider }) => provider === "nova")).toMatchObject({ publicReadiness: "ready" });
  expect(JSON.stringify(resources)).not.toContain(secret);
});

test("public readiness fails closed on unhealthy, redirected, malformed, or unreachable endpoints", async () => {
  const identity = () => Response.json({
    service: "nova-api", status: "identified",
    runtime: { adapter: "netlify", id: "deploy-1" },
    database: { fingerprint: "b".repeat(64), schemaReady: true, migrationLedgerPresent: true },
    scheduler: "supabase",
  });
  const run = async (readiness: () => Promise<Response>) => {
    const resources = await discoverProviderResources({
      NOVA_PUBLIC_ORIGIN: "https://nova.example",
      NOVA_BACKGROUND_JOB_SECRET: "identity-secret",
    }, async (input) => String(input).endsWith("/api/ready") ? readiness() : identity(),
    { probePublicReadiness: true });
    return resources.find(({ provider }) => provider === "nova")?.publicReadiness;
  };
  expect(await run(async () => Response.json({ service: "nova-api", status: "not_ready" }, { status: 503 }))).toBe("not-ready");
  expect(await run(async () => Response.redirect("https://other.example/ready", 302))).toBe("unavailable");
  expect(await run(async () => new Response("not json"))).toBe("unavailable");
  expect(await run(async () => { throw new Error("private transport details"); })).toBe("unavailable");
});

test("live identity omits malformed runtime IDs and release metadata", async () => {
  const resources = await discoverProviderResources({
    NOVA_PUBLIC_ORIGIN: "https://nova.example",
    NOVA_BACKGROUND_JOB_SECRET: "identity-secret",
  }, async () => Response.json({
    service: "nova-api",
    status: "identified",
    runtime: { adapter: "cloudflare", id: "bad\nvalue", releaseSha: "not-a-commit" },
    database: { fingerprint: "b".repeat(64), schemaReady: true, migrationLedgerPresent: true },
    scheduler: "supabase",
  }));
  const identity = resources.find(({ provider }) => provider === "nova");
  expect(identity).toMatchObject({ provider: "nova", state: "identified", runtime: "cloudflare" });
  expect(identity).not.toHaveProperty("runtimeId");
  expect(identity).not.toHaveProperty("release");
});

test("live identity secret is never sent to non-HTTPS or non-origin URLs", async () => {
  let requests = 0;
  const fetcher: ProviderFetcher = async () => { requests += 1; throw new Error("must not fetch"); };
  const resources = await discoverProviderResources({
    NOVA_PUBLIC_ORIGIN: "http://nova.example/path",
    NOVA_BACKGROUND_JOB_SECRET: "secret",
  }, fetcher);
  expect(requests).toBe(0);
  expect(resources.find(({ provider }) => provider === "nova")).toEqual({
    provider: "nova",
    state: "unavailable",
    detail: "PUBLIC_ORIGIN_MUST_BE_HTTPS_ORIGIN_ONLY",
  });
});
