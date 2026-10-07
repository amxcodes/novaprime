import type { ProviderFetcher, ProviderResource, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeProviderId } from "./shared.ts";

export async function inspectCloudflare(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher,
): Promise<ProviderResource> {
  const token = environment.CLOUDFLARE_API_TOKEN;
  if (!token) return { provider: "cloudflare", state: "not-configured" };
  const account = safeProviderId(environment.CLOUDFLARE_ACCOUNT_ID);
  const worker = safeProviderId(environment.CLOUDFLARE_WORKER_NAME);
  if (!account || !worker) return { provider: "cloudflare", state: "target-required" };
  try {
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(worker)}`;
    const envelope = asObject(await getProviderJson(fetcher, base, token, "cloudflare"));
    const script = asObject(envelope?.result);
    if (!envelope?.success || !script) throw new Error("cloudflare:RESPONSE_INVALID");
    let schedulerInventory: SchedulerTriggerInventory;
    try {
      const response = asObject(await getProviderJson(fetcher, `${base}/schedules`, token, "cloudflare"));
      const result = response?.result;
      const schedules = Array.isArray(result)
        ? result
        : Array.isArray(asObject(result)?.schedules) ? asObject(result)?.schedules as unknown[] : [];
      schedulerInventory = {
        scope: "target-runtime", state: "verified", completeness: "resource-only",
        triggers: schedules.flatMap((entry, index) => {
          const schedule = firstString(asObject(entry)?.cron);
          return schedule ? [{ id: `${worker}/schedule-${index + 1}`, name: "cloudflare-cron-trigger", schedule, active: true }] : [];
        }),
      };
    } catch (error) {
      schedulerInventory = {
        scope: "target-runtime", state: "unavailable", completeness: "resource-only", triggers: [],
        detail: providerFailure("cloudflare", error).detail,
      };
    }
    return {
      provider: "cloudflare", state: "identified", target: `${account}/${worker}`, runtime: "cloudflare",
      schedulerInventory,
      ...(firstString(script.modified_on) ? { detail: `SCRIPT_MODIFIED_${script.modified_on}` } : {}),
    };
  } catch (error) { return providerFailure("cloudflare", error); }
}
