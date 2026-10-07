import type { ProviderFetcher, ProviderResource, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHttpsOrigin, safeProviderId, safeReleaseSha } from "./shared.ts";

function publishedFunctionSchedules(deploy: Record<string, unknown> | undefined): SchedulerTriggerInventory {
  const schedules = deploy?.function_schedules;
  if (!Array.isArray(schedules) || schedules.length > 100) {
    return {
      scope: "target-runtime", state: "unavailable", completeness: "partial", triggers: [],
      detail: "NETLIFY_PUBLISHED_DEPLOY_SCHEDULE_INVENTORY_UNAVAILABLE",
    };
  }
  const triggers = schedules.map((entry) => {
    const schedule = asObject(entry);
    const name = firstString(schedule?.name);
    const cron = firstString(schedule?.cron);
    return name && /^[A-Za-z0-9_.:-]{1,120}$/.test(name) && cron && cron.length <= 120
      ? { id: name, name, schedule: cron, active: true }
      : null;
  });
  if (triggers.some((trigger) => trigger === null) || new Set(triggers.map((trigger) => trigger?.id)).size !== triggers.length) {
    return {
      scope: "target-runtime", state: "unavailable", completeness: "partial", triggers: [],
      detail: "NETLIFY_PUBLISHED_DEPLOY_SCHEDULE_INVENTORY_INVALID",
    };
  }
  const verifiedTriggers = triggers.filter((trigger): trigger is NonNullable<typeof trigger> => trigger !== null);
  return {
    scope: "target-runtime",
    state: verifiedTriggers.length ? "verified" : "not-installed",
    completeness: "project-scoped",
    triggers: verifiedTriggers,
  };
}

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
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}/deploys?production=true&latest-published=true&per_page=1`, token, "netlify");
    if (!Array.isArray(deploys)) throw new Error("netlify:RESPONSE_INVALID");
    const recentDeploys = deploys.map(asObject).filter((item): item is Record<string, unknown> => item !== null);
    const latestProduction = recentDeploys.find((item) => item.context === "production" && item.state === "ready" && item.published === true);
    const revision = safeProviderId(firstString(latestProduction?.id));
    return {
      provider: "netlify", state: "identified", target: id, runtime: "netlify",
      ...(revision ? { revision } : {}),
      ...(safeReleaseSha(firstString(latestProduction?.commit_sha, latestProduction?.commit_ref, latestProduction?.commit))
        ? { release: safeReleaseSha(firstString(latestProduction?.commit_sha, latestProduction?.commit_ref, latestProduction?.commit)) } : {}),
      ...(safeHttpsOrigin(firstString(site.ssl_url, site.url)) ? { origin: safeHttpsOrigin(firstString(site.ssl_url, site.url)) } : {}),
      schedulerInventory: publishedFunctionSchedules(latestProduction),
      detail: latestProduction ? "PRODUCTION_DEPLOY_READY" : "PRODUCTION_DEPLOY_NOT_CONFIRMED",
    };
  } catch (error) { return providerFailure("netlify", error); }
}
