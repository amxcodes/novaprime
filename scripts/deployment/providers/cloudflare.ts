import type { DomainRouteInventory, ProviderFetcher, ProviderResource, RuntimeBindingInventory, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHostname, safeProviderId, safeSchedulerSelector } from "./shared.ts";

const domainsPerPage = 100;
const maxDomainPages = 20;

function cloudflareBindings(value: unknown): RuntimeBindingInventory {
  if (!Array.isArray(value) || value.length > 500) {
    return { state: "unavailable", completeness: "partial", bindings: [], detail: "CLOUDFLARE_RUNTIME_BINDING_INVENTORY_INVALID" };
  }
  const bindings: RuntimeBindingInventory["bindings"] = [];
  const names = new Set<string>();
  let configuredScheduler: string | undefined;
  for (const entry of value) {
    const binding = asObject(entry);
    const name = firstString(binding?.name);
    const type = firstString(binding?.type);
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || !type ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(type) || names.has(name)) {
      return { state: "unavailable", completeness: "partial", bindings: [], detail: "CLOUDFLARE_RUNTIME_BINDING_INVENTORY_INVALID" };
    }
    names.add(name);
    if (name === "NOVA_BACKGROUND_SCHEDULER") configuredScheduler = safeSchedulerSelector(binding?.text ?? binding?.value);
    bindings.push({ name, type, scopes: ["worker"], contexts: ["production"], secret: type.startsWith("secret") });
  }
  return {
    state: "verified", completeness: "selected-runtime", bindings: bindings.sort((left, right) => left.name.localeCompare(right.name)),
    ...(configuredScheduler ? { configuredScheduler } : {}),
  };
}

async function workerDomains(
  account: string,
  worker: string,
  token: string,
  fetcher: ProviderFetcher,
): Promise<DomainRouteInventory> {
  const domains = new Map<string, DomainRouteInventory["domains"][number]>();
  let expectedPages: number | undefined;
  for (let page = 1; page <= maxDomainPages; page += 1) {
    const query = new URLSearchParams({ service: worker, page: String(page), per_page: String(domainsPerPage) });
    let envelope: Record<string, unknown> | null;
    try {
      envelope = asObject(await getProviderJson(fetcher,
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/domains?${query}`, token, "cloudflare"));
    } catch (error) {
      return { state: "unavailable", completeness: "partial", domains: [...domains.values()], detail: providerFailure("cloudflare", error).detail };
    }
    const result = envelope && Array.isArray(envelope.result) ? envelope.result : null;
    const resultInfo = asObject(envelope?.result_info);
    const totalPages = resultInfo?.total_pages;
    if (!envelope?.success || !result || !Number.isInteger(totalPages) || (totalPages as number) < 0 || !resultInfo ||
        (resultInfo.page !== undefined && resultInfo.page !== page)) {
      return { state: "unavailable", completeness: "partial", domains: [...domains.values()], detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
    }
    if (totalPages === 0) {
      if (page !== 1 || result.length !== 0 || domains.size !== 0) {
        return { state: "unavailable", completeness: "partial", domains: [...domains.values()], detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
      }
      return { state: "verified", completeness: "selected-runtime", domains: [] };
    }
    if (expectedPages === undefined) expectedPages = totalPages as number;
    if (expectedPages !== totalPages) {
      return { state: "unavailable", completeness: "partial", domains: [...domains.values()], detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_CHANGED_DURING_READ" };
    }
    for (const entry of result) {
      const domain = asObject(entry);
      const service = firstString(domain?.service);
      const hostname = safeHostname(domain?.hostname);
      if (service !== worker || !hostname || domains.has(hostname)) {
        return { state: "unavailable", completeness: "partial", domains: [...domains.values()], detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
      }
      domains.set(hostname, { hostname, source: "custom-domain" });
    }
    if (page >= expectedPages) {
      return { state: "verified", completeness: "selected-runtime", domains: [...domains.values()].sort((left, right) => left.hostname.localeCompare(right.hostname)) };
    }
    if (page === maxDomainPages) break;
  }
  return { state: "unavailable", completeness: "partial", domains: [...domains.values()], detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_PAGE_LIMIT" };
}

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
    const [schedulerInventory, settings, domainRoutes] = await Promise.all([
      (async (): Promise<SchedulerTriggerInventory> => {
        try {
          const response = asObject(await getProviderJson(fetcher, `${base}/schedules`, token, "cloudflare"));
          const result = response?.result;
          const schedules = Array.isArray(result)
            ? result
            : Array.isArray(asObject(result)?.schedules) ? asObject(result)?.schedules as unknown[] : [];
          if (!response?.success || (!Array.isArray(result) && !Array.isArray(asObject(result)?.schedules))) {
            throw new Error("cloudflare:RESPONSE_INVALID");
          }
          return {
            scope: "target-runtime", state: "verified", completeness: "resource-only",
            triggers: schedules.flatMap((entry, index) => {
              const schedule = firstString(asObject(entry)?.cron);
              return schedule ? [{ id: `${worker}/schedule-${index + 1}`, name: "cloudflare-cron-trigger", schedule, active: true }] : [];
            }),
          };
        } catch (error) {
          return {
            scope: "target-runtime", state: "unavailable", completeness: "resource-only", triggers: [],
            detail: providerFailure("cloudflare", error).detail,
          };
        }
      })(),
      (async (): Promise<RuntimeBindingInventory> => {
        try {
          const response = asObject(await getProviderJson(fetcher, `${base}/settings`, token, "cloudflare"));
          const result = asObject(response?.result);
          if (!response?.success || !result || !Array.isArray(result.bindings)) {
            return { state: "unavailable", completeness: "partial", bindings: [], detail: "CLOUDFLARE_RUNTIME_BINDING_INVENTORY_INVALID" };
          }
          return cloudflareBindings(result.bindings);
        } catch (error) {
          return { state: "unavailable", completeness: "partial", bindings: [], detail: providerFailure("cloudflare", error).detail };
        }
      })(),
      workerDomains(account, worker, token, fetcher),
    ]);
    const revision = safeProviderId(firstString(script.etag, script.modified_on));
    return {
      provider: "cloudflare", state: "identified", target: `${account}/${worker}`, runtime: "cloudflare",
      ...(revision ? { revision } : {}),
      schedulerInventory,
      runtimeBindings: settings,
      domainRoutes,
      ...(firstString(script.modified_on) ? { detail: `SCRIPT_MODIFIED_${script.modified_on}` } : {}),
    };
  } catch (error) { return providerFailure("cloudflare", error); }
}
