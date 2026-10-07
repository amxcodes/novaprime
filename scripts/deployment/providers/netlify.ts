import type { ProviderFetcher, ProviderResource } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHttpsOrigin, safeProviderId, safeReleaseSha } from "./shared.ts";

export async function inspectNetlify(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher,
): Promise<ProviderResource> {
  const token = environment.NETLIFY_AUTH_TOKEN;
  if (!token) return { provider: "netlify", state: "not-configured" };
  const id = safeProviderId(environment.NETLIFY_SITE_ID);
  if (!id) return { provider: "netlify", state: "target-required" };
  try {
    const site = asObject(await getProviderJson(fetcher,
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}`, token, "netlify"));
    if (!site) throw new Error("netlify:RESPONSE_INVALID");
    const deploys = await getProviderJson<unknown>(fetcher,
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}/deploys?per_page=1`, token, "netlify");
    const recentDeploys = Array.isArray(deploys)
      ? deploys.map(asObject).filter((item): item is Record<string, unknown> => item !== null)
      : [];
    const latestProduction = recentDeploys.find((item) => item.context === "production" && item.state === "ready");
    return {
      provider: "netlify", state: "identified", target: id, runtime: "netlify",
      ...(safeReleaseSha(firstString(latestProduction?.commit_sha, latestProduction?.commit_ref, latestProduction?.commit))
        ? { release: safeReleaseSha(firstString(latestProduction?.commit_sha, latestProduction?.commit_ref, latestProduction?.commit)) } : {}),
      ...(safeHttpsOrigin(firstString(site.ssl_url, site.url)) ? { origin: safeHttpsOrigin(firstString(site.ssl_url, site.url)) } : {}),
      schedulerInventory: {
        scope: "target-runtime", state: "target-required", completeness: "partial", triggers: [],
        detail: "NETLIFY_SCHEDULE_REQUIRES_EXACT_DEPLOY_SOURCE_RECONCILIATION",
      },
      detail: latestProduction ? "PRODUCTION_DEPLOY_READY" : "PRODUCTION_DEPLOY_NOT_CONFIRMED",
    };
  } catch (error) { return providerFailure("netlify", error); }
}
