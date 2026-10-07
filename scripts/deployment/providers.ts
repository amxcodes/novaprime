export type ProviderName = "netlify" | "cloudflare" | "vercel" | "supabase" | "nova";

export interface ProviderResource {
  provider: ProviderName;
  state: "identified" | "target-required" | "not-configured" | "unavailable";
  target?: string;
  runtime?: string;
  release?: string;
  origin?: string;
  databaseVersion?: string;
  databaseFingerprint?: string;
  schemaReady?: boolean;
  migrationLedgerPresent?: boolean;
  scheduler?: string[];
  detail?: string;
}

export type ProviderFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const idPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const projectRefPattern = /^[a-z0-9]{20}$/;
const timeoutMs = 10_000;
const maxResponseBytes = 1_000_000;

function safeId(value: string | undefined): string | undefined {
  return value && idPattern.test(value) ? value : undefined;
}

function errorCode(status: number): string {
  if (status === 401) return "CREDENTIAL_REJECTED";
  if (status === 403) return "MISSING_READ_PERMISSION";
  if (status === 404) return "TARGET_NOT_FOUND_OR_NOT_VISIBLE";
  if (status === 429) return "RATE_LIMITED_RETRY_LATER";
  return `PROVIDER_HTTP_${status}`;
}

async function getJson<T>(fetcher: ProviderFetcher, url: string, token: string, provider: ProviderName): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error && error.name === "TimeoutError" ? "REQUEST_TIMEOUT" : "REQUEST_FAILED";
    throw new Error(`${provider}:${name}`);
  }
  if (!response.ok) throw new Error(`${provider}:${errorCode(response.status)}`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxResponseBytes) throw new Error(`${provider}:RESPONSE_TOO_LARGE`);
  let text: string;
  try { text = await response.text(); }
  catch { throw new Error(`${provider}:RESPONSE_READ_FAILED`); }
  if (Buffer.byteLength(text, "utf8") > maxResponseBytes) throw new Error(`${provider}:RESPONSE_TOO_LARGE`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${provider}:RESPONSE_INVALID`); }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function errorResource(provider: ProviderName, error: unknown): ProviderResource {
  const detail = error instanceof Error && /^(netlify|cloudflare|vercel|supabase|nova):[A-Z0-9_:-]+$/.test(error.message)
    ? error.message.split(":").slice(1).join(":")
    : "PROVIDER_READ_FAILED";
  return { provider, state: "unavailable", detail };
}

export async function discoverProviderResources(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher = fetch,
): Promise<ProviderResource[]> {
  const resources: ProviderResource[] = [];
  const netlifyToken = environment.NETLIFY_AUTH_TOKEN;
  if (!netlifyToken) resources.push({ provider: "netlify", state: "not-configured" });
  else if (!safeId(environment.NETLIFY_SITE_ID)) resources.push({ provider: "netlify", state: "target-required" });
  else {
    const id = safeId(environment.NETLIFY_SITE_ID)!;
    try {
      const site = object(await getJson(fetcher, `https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}`, netlifyToken, "netlify"));
      if (!site) throw new Error("netlify:RESPONSE_INVALID");
      const deploys = await getJson<unknown>(fetcher, `https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}/deploys?per_page=1`, netlifyToken, "netlify");
      const recentDeploys = Array.isArray(deploys) ? deploys.map(object).filter((item): item is Record<string, unknown> => item !== null) : [];
      const latestProduction = recentDeploys.find((item) => item.context === "production" && item.state === "ready");
      resources.push({
        provider: "netlify", state: "identified", target: id, runtime: "netlify",
        ...(firstString(latestProduction?.commit_ref, latestProduction?.commit_sha, latestProduction?.commit)
          ? { release: firstString(latestProduction?.commit_ref, latestProduction?.commit_sha, latestProduction?.commit) } : {}),
        ...(firstString(site.ssl_url, site.url) ? { origin: firstString(site.ssl_url, site.url) } : {}),
        detail: latestProduction ? "PRODUCTION_DEPLOY_READY" : "PRODUCTION_DEPLOY_NOT_CONFIRMED",
      });
    } catch (error) { resources.push(errorResource("netlify", error)); }
  }

  const cloudflareToken = environment.CLOUDFLARE_API_TOKEN;
  const cloudflareAccount = safeId(environment.CLOUDFLARE_ACCOUNT_ID);
  const cloudflareWorker = safeId(environment.CLOUDFLARE_WORKER_NAME);
  if (!cloudflareToken) resources.push({ provider: "cloudflare", state: "not-configured" });
  else if (!cloudflareAccount || !cloudflareWorker) resources.push({ provider: "cloudflare", state: "target-required" });
  else {
    try {
      const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccount)}/workers/scripts/${encodeURIComponent(cloudflareWorker)}`;
      const response = object(await getJson(fetcher, base, cloudflareToken, "cloudflare"));
      const script = object(response?.result);
      if (!response?.success || !script) throw new Error("cloudflare:RESPONSE_INVALID");
      const schedulesResponse = object(await getJson(fetcher, `${base}/schedules`, cloudflareToken, "cloudflare"));
      const scheduleResult = schedulesResponse?.result;
      const schedules = Array.isArray(scheduleResult)
        ? scheduleResult
        : Array.isArray(object(scheduleResult)?.schedules) ? object(scheduleResult)?.schedules as unknown[] : [];
      const expressions = schedules.map((entry) => firstString(object(entry)?.cron)).filter((item): item is string => Boolean(item));
      resources.push({
        provider: "cloudflare", state: "identified", target: `${cloudflareAccount}/${cloudflareWorker}`, runtime: "cloudflare",
        scheduler: expressions,
        ...(firstString(script.modified_on) ? { detail: `SCRIPT_MODIFIED_${script.modified_on}` } : {}),
      });
    } catch (error) { resources.push(errorResource("cloudflare", error)); }
  }

  const vercelToken = environment.VERCEL_TOKEN;
  const vercelProject = safeId(environment.VERCEL_PROJECT_ID);
  if (!vercelToken) resources.push({ provider: "vercel", state: "not-configured" });
  else if (!vercelProject) resources.push({ provider: "vercel", state: "target-required" });
  else {
    try {
      const teamQuery = environment.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(environment.VERCEL_TEAM_ID)}` : "";
      const project = object(await getJson(fetcher, `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProject)}${teamQuery}`, vercelToken, "vercel"));
      if (!project) throw new Error("vercel:RESPONSE_INVALID");
      const deploymentQuery = new URLSearchParams({ projectId: vercelProject, limit: "1", target: "production" });
      if (environment.VERCEL_TEAM_ID) deploymentQuery.set("teamId", environment.VERCEL_TEAM_ID);
      const deployments = object(await getJson(fetcher, `https://api.vercel.com/v6/deployments?${deploymentQuery}`, vercelToken, "vercel"));
      const latest = Array.isArray(deployments?.deployments) ? object(deployments.deployments[0]) : null;
      resources.push({
        provider: "vercel", state: "identified", target: vercelProject, runtime: "vercel",
        ...(firstString(latest?.meta && object(latest.meta)?.githubCommitSha) ? { release: firstString(object(latest?.meta)?.githubCommitSha) } : {}),
        ...(firstString(latest?.url) ? { origin: `https://${firstString(latest?.url)}` } : {}),
        ...(firstString(latest?.readyState) ? { detail: `LATEST_DEPLOY_${String(latest?.readyState).toUpperCase()}` } : {}),
      });
    } catch (error) { resources.push(errorResource("vercel", error)); }
  }

  const supabaseToken = environment.SUPABASE_ACCESS_TOKEN;
  const projectRef = environment.NOVA_SUPABASE_PROJECT_REF;
  if (!supabaseToken) resources.push({ provider: "supabase", state: "not-configured" });
  else if (!projectRefPattern.test(projectRef ?? "")) resources.push({ provider: "supabase", state: "target-required" });
  else {
    try {
      const [projectValue, healthValue] = await Promise.all([
        getJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}`, supabaseToken, "supabase"),
        getJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}/health`, supabaseToken, "supabase"),
      ]);
      const project = object(projectValue);
      const health = Array.isArray(healthValue) ? healthValue : [];
      if (!project) throw new Error("supabase:RESPONSE_INVALID");
      const database = object(project.database);
      const statuses = health.map((item) => firstString(object(item)?.status)).filter((item): item is string => Boolean(item));
      resources.push({
        provider: "supabase", state: "identified", target: projectRef, runtime: "postgresql",
        ...(firstString(database?.version, database?.postgres_engine) ? { databaseVersion: firstString(database?.version, database?.postgres_engine) } : {}),
        detail: statuses.length ? `SERVICE_HEALTH_${statuses.join(",").toUpperCase()}` : "PROJECT_IDENTIFIED_HEALTH_UNKNOWN",
      });
    } catch (error) { resources.push(errorResource("supabase", error)); }
  }

  const publicOrigin = environment.NOVA_PUBLIC_ORIGIN ?? environment.BETTER_AUTH_URL;
  const identitySecret = environment.NOVA_BACKGROUND_JOB_SECRET;
  if (!publicOrigin && !identitySecret) resources.push({ provider: "nova", state: "not-configured" });
  else if (!publicOrigin || !identitySecret) resources.push({ provider: "nova", state: "target-required", detail: "PUBLIC_ORIGIN_AND_IDENTITY_SECRET_REQUIRED" });
  else {
    try {
      let origin: URL;
      try { origin = new URL(publicOrigin); }
      catch { throw new Error("nova:PUBLIC_ORIGIN_INVALID"); }
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
        throw new Error("nova:PUBLIC_ORIGIN_MUST_BE_HTTPS_ORIGIN_ONLY");
      }
      const identity = object(await getJson(fetcher,
        new URL("/api/internal/deployment/identity", origin).toString(), identitySecret, "nova"));
      const runtime = object(identity?.runtime);
      const database = object(identity?.database);
      const scheduler = firstString(identity?.scheduler);
      if (identity?.service !== "nova-api" || identity.status !== "identified" || !runtime || !database ||
          typeof database.fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(database.fingerprint) ||
          typeof database.schemaReady !== "boolean" || typeof database.migrationLedgerPresent !== "boolean") {
        throw new Error("nova:IDENTITY_RESPONSE_INVALID");
      }
      const safeScheduler = scheduler && ["cloudflare", "netlify", "vercel", "supabase", "vps"].includes(scheduler)
        ? [scheduler]
        : [];
      const safeRuntime = firstString(runtime.adapter);
      const safeRelease = firstString(runtime.releaseSha);
      resources.push({
        provider: "nova", state: "identified", target: origin.origin,
        ...(safeRuntime && ["cloudflare", "netlify", "vercel", "vps"].includes(safeRuntime) ? { runtime: safeRuntime } : {}),
        ...(safeRelease && /^(?:[a-f0-9]{7,64})$/i.test(safeRelease) ? { release: safeRelease.toLowerCase() } : {}),
        databaseFingerprint: database.fingerprint.toLowerCase(),
        schemaReady: database.schemaReady,
        migrationLedgerPresent: database.migrationLedgerPresent,
        scheduler: safeScheduler,
        detail: `SCHEMA_${database.schemaReady ? "READY" : "NOT_READY"};MIGRATION_LEDGER_${database.migrationLedgerPresent ? "VISIBLE" : "NOT_VISIBLE_TO_APP_ROLE"}`,
      });
    } catch (error) { resources.push(errorResource("nova", error)); }
  }
  return resources;
}
