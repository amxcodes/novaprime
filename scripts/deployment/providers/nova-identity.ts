import type { ProviderFetcher, ProviderResource } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure } from "./shared.ts";

const schedulers = ["cloudflare", "netlify", "vercel", "supabase", "vps"];
const runtimes = ["cloudflare", "netlify", "vercel", "vps"];

export async function inspectNovaIdentity(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher,
): Promise<ProviderResource> {
  const publicOrigin = environment.NOVA_PUBLIC_ORIGIN ?? environment.BETTER_AUTH_URL;
  const secret = environment.NOVA_BACKGROUND_JOB_SECRET;
  if (!publicOrigin && !secret) return { provider: "nova", state: "not-configured" };
  if (!publicOrigin || !secret) {
    return { provider: "nova", state: "target-required", detail: "PUBLIC_ORIGIN_AND_IDENTITY_SECRET_REQUIRED" };
  }
  try {
    let origin: URL;
    try { origin = new URL(publicOrigin); }
    catch { throw new Error("nova:PUBLIC_ORIGIN_INVALID"); }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
      throw new Error("nova:PUBLIC_ORIGIN_MUST_BE_HTTPS_ORIGIN_ONLY");
    }
    const identity = asObject(await getProviderJson(fetcher,
      new URL("/api/internal/deployment/identity", origin).toString(), secret, "nova"));
    const runtime = asObject(identity?.runtime);
    const database = asObject(identity?.database);
    const configuredScheduler = firstString(identity?.scheduler);
    if (identity?.service !== "nova-api" || identity.status !== "identified" || !runtime || !database ||
        typeof database.fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(database.fingerprint) ||
        typeof database.schemaReady !== "boolean" || typeof database.migrationLedgerPresent !== "boolean") {
      throw new Error("nova:IDENTITY_RESPONSE_INVALID");
    }
    const runtimeAdapter = firstString(runtime.adapter);
    const runtimeId = firstString(runtime.id);
    const releaseSha = firstString(runtime.releaseSha);
    return {
      provider: "nova", state: "identified", target: origin.origin,
      ...(runtimeAdapter && runtimes.includes(runtimeAdapter) ? { runtime: runtimeAdapter } : {}),
      ...(runtimeId && /^[A-Za-z0-9._:-]{1,160}$/.test(runtimeId) ? { runtimeId } : {}),
      ...(releaseSha && /^(?:[a-f0-9]{7,64})$/i.test(releaseSha) ? { release: releaseSha.toLowerCase() } : {}),
      databaseFingerprint: database.fingerprint.toLowerCase(),
      schemaReady: database.schemaReady,
      migrationLedgerPresent: database.migrationLedgerPresent,
      ...(configuredScheduler && schedulers.includes(configuredScheduler) ? { configuredScheduler } : {}),
      detail: `SCHEMA_${database.schemaReady ? "READY" : "NOT_READY"};MIGRATION_LEDGER_${database.migrationLedgerPresent ? "VISIBLE" : "NOT_VISIBLE_TO_APP_ROLE"}`,
    };
  } catch (error) { return providerFailure("nova", error); }
}
