import { expect, test } from "bun:test";
import { discoverProviderResources, type ProviderFetcher } from "./providers.ts";

test("provider discovery requests only explicit target resources and returns metadata only", async () => {
  const requests: Array<{ url: string; token: string }> = [];
  const fetcher: ProviderFetcher = async (input, init) => {
    const url = String(input);
    const token = new Headers(init?.headers).get("authorization") ?? "";
    requests.push({ url, token });
    if (url.endsWith("/sites/site-id")) return Response.json({ id: "site-id", ssl_url: "https://nova.example" });
    if (url.includes("/sites/site-id/deploys")) return Response.json([{ state: "ready", context: "production", commit_ref: "a".repeat(40) }]);
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
    release: "a".repeat(40),
    databaseFingerprint: "b".repeat(64),
    schemaReady: true,
  }));
  expect(JSON.stringify(resources)).not.toContain(secret);
  expect(JSON.stringify(resources)).not.toContain("should never be retained");
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
