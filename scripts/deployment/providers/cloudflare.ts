import type { DomainRouteInventory, ProviderFetcher, ProviderResource, RuntimeBindingInventory, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHostname, safeProviderId, safeSchedulerSelector } from "./shared.ts";

const domainsPerPage = 100;
const maxDomainPages = 20;
const maxRoutingDomains = 12;
const routesPerPage = 100;
const maxRoutePages = 20;
const maxDnsPages = 2;

interface WorkerDomain { hostname: string; zoneId: string }

async function cloudflarePages(
  urlForPage: (page: number) => string,
  token: string,
  fetcher: ProviderFetcher,
  invalidDetail: string,
  maxPages = maxRoutePages,
): Promise<unknown[]> {
  const entries: unknown[] = [];
  let expectedPages: number | undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    const envelope = asObject(await getProviderJson(fetcher, urlForPage(page), token, "cloudflare"));
    const result = envelope && Array.isArray(envelope.result) ? envelope.result : null;
    const info = asObject(envelope?.result_info);
    const totalPages = info?.total_pages;
    if (!envelope?.success || !result || !info || !Number.isInteger(totalPages) ||
        (totalPages as number) < 0 || (totalPages as number) > maxPages ||
        (info.page !== undefined && info.page !== page)) throw new Error(`cloudflare:${invalidDetail}`);
    if (totalPages === 0) {
      if (page !== 1 || result.length !== 0 || entries.length !== 0) throw new Error(`cloudflare:${invalidDetail}`);
      return [];
    }
    if (expectedPages === undefined) expectedPages = totalPages as number;
    if (expectedPages !== totalPages) throw new Error("cloudflare:INVENTORY_CHANGED_DURING_READ");
    entries.push(...result);
    if (page === expectedPages) return entries;
  }
  throw new Error("cloudflare:INVENTORY_PAGE_LIMIT");
}

async function zoneRouting(
  zoneId: string,
  domains: readonly string[],
  token: string,
  fetcher: ProviderFetcher,
): Promise<NonNullable<DomainRouteInventory["cloudflareRouting"]>["zones"][number]> {
  try {
    const routeEntries = await cloudflarePages((page) => {
      const query = new URLSearchParams({ page: String(page), per_page: String(routesPerPage) });
      return `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/workers/routes?${query}`;
    }, token, fetcher, "WORKER_ROUTE_INVENTORY_INVALID");
    const routes = routeEntries.map((entry) => {
      const route = asObject(entry);
      const pattern = firstString(route?.pattern);
      const script = route?.script;
      if (!pattern || pattern.length > 1_000 || /[\u0000-\u001f]/.test(pattern) ||
          (script !== undefined && script !== null && (typeof script !== "string" || !safeProviderId(script)))) {
        throw new Error("cloudflare:WORKER_ROUTE_INVENTORY_INVALID");
      }
      return { pattern, script: typeof script === "string" ? script : null };
    });
    const routeKeys = new Set(routes.map(({ pattern, script }) => `${pattern}\u0000${script ?? ""}`));
    if (routeKeys.size !== routes.length) throw new Error("cloudflare:WORKER_ROUTE_INVENTORY_INVALID");

    const dnsRecords: Array<{ hostname: string; type: string; proxied: boolean }> = [];
    for (const hostname of domains) {
      const records = await cloudflarePages((page) => {
        const query = new URLSearchParams({ name: hostname, page: String(page), per_page: String(routesPerPage) });
        return `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/dns_records?${query}`;
      }, token, fetcher, "DNS_RECORD_INVENTORY_INVALID", maxDnsPages);
      for (const entry of records) {
        const record = asObject(entry);
        const recordHostname = safeHostname(record?.name);
        const type = firstString(record?.type);
        if (recordHostname !== hostname || !type || !/^[A-Z0-9]{1,16}$/.test(type) || typeof record?.proxied !== "boolean") {
          throw new Error("cloudflare:DNS_RECORD_INVENTORY_INVALID");
        }
        dnsRecords.push({ hostname, type, proxied: record.proxied });
      }
    }
    return {
      zoneId,
      hostnames: [...domains].sort(),
      state: "verified",
      routes: routes.sort((left, right) => left.pattern.localeCompare(right.pattern) || (left.script ?? "").localeCompare(right.script ?? "")),
      dnsRecords: dnsRecords.sort((left, right) => left.hostname.localeCompare(right.hostname) || left.type.localeCompare(right.type) || Number(left.proxied) - Number(right.proxied)),
    };
  } catch (error) {
    return {
      zoneId,
      hostnames: [...domains].sort(),
      state: "unavailable",
      routes: [],
      dnsRecords: [],
      detail: providerFailure("cloudflare", error).detail,
    };
  }
}

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
  const domains = new Map<string, WorkerDomain>();
  let expectedPages: number | undefined;
  for (let page = 1; page <= maxDomainPages; page += 1) {
    const query = new URLSearchParams({ service: worker, page: String(page), per_page: String(domainsPerPage) });
    let envelope: Record<string, unknown> | null;
    try {
      envelope = asObject(await getProviderJson(fetcher,
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/domains?${query}`, token, "cloudflare"));
    } catch (error) {
      return { state: "unavailable", completeness: "partial", domains: [...domains.keys()].map((hostname) => ({ hostname, source: "custom-domain" })), detail: providerFailure("cloudflare", error).detail };
    }
    const result = envelope && Array.isArray(envelope.result) ? envelope.result : null;
    const resultInfo = asObject(envelope?.result_info);
    const totalPages = resultInfo?.total_pages;
    if (!envelope?.success || !result || !Number.isInteger(totalPages) || (totalPages as number) < 0 || !resultInfo ||
        (resultInfo.page !== undefined && resultInfo.page !== page)) {
      return { state: "unavailable", completeness: "partial", domains: [...domains.keys()].map((hostname) => ({ hostname, source: "custom-domain" })), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
    }
    if (totalPages === 0) {
      if (page !== 1 || result.length !== 0 || domains.size !== 0) {
        return { state: "unavailable", completeness: "partial", domains: [...domains.keys()].map((hostname) => ({ hostname, source: "custom-domain" })), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
      }
      return {
        state: "verified", completeness: "selected-runtime", domains: [],
        cloudflareRouting: { state: "verified", completeness: "selected-runtime", zones: [] },
      };
    }
    if (expectedPages === undefined) expectedPages = totalPages as number;
    if (expectedPages !== totalPages) {
      return { state: "unavailable", completeness: "partial", domains: [...domains.keys()].map((hostname) => ({ hostname, source: "custom-domain" })), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_CHANGED_DURING_READ" };
    }
    for (const entry of result) {
      const domain = asObject(entry);
      const service = firstString(domain?.service);
      const hostname = safeHostname(domain?.hostname);
      const zoneId = firstString(domain?.zone_id);
      if (service !== worker || !hostname || !zoneId || !/^[a-f0-9]{32}$/i.test(zoneId) || domains.has(hostname)) {
        return { state: "unavailable", completeness: "partial", domains: [...domains.keys()].map((hostname) => ({ hostname, source: "custom-domain" })), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
      }
      domains.set(hostname, { hostname, zoneId: zoneId.toLowerCase() });
    }
    if (page >= expectedPages) {
      const selectedDomains = [...domains.values()].sort((left, right) => left.hostname.localeCompare(right.hostname));
      const domainsByZone = new Map<string, string[]>();
      for (const domain of selectedDomains) {
        const zoneDomains = domainsByZone.get(domain.zoneId) ?? [];
        zoneDomains.push(domain.hostname);
        domainsByZone.set(domain.zoneId, zoneDomains);
      }
      if (domainsByZone.size > maxRoutingDomains || selectedDomains.length > maxRoutingDomains) {
        return {
          state: "verified", completeness: "selected-runtime",
          domains: selectedDomains.map(({ hostname }) => ({ hostname, source: "custom-domain" })),
          cloudflareRouting: { state: "unavailable", completeness: "partial", zones: [], detail: "CLOUDFLARE_ROUTING_DOMAIN_LIMIT" },
        };
      }
      const zoneEvidence = await Promise.all([...domainsByZone].map(([zoneId, hostnames]) => zoneRouting(zoneId, hostnames, token, fetcher)));
      const routingComplete = zoneEvidence.every(({ state }) => state === "verified");
      return {
        state: "verified", completeness: "selected-runtime",
        domains: selectedDomains.map(({ hostname }) => ({ hostname, source: "custom-domain" })),
        cloudflareRouting: {
          state: routingComplete ? "verified" : "unavailable",
          completeness: routingComplete ? "selected-runtime" : "partial",
          zones: zoneEvidence,
          ...(routingComplete ? {} : { detail: "CLOUDFLARE_ROUTING_INVENTORY_INCOMPLETE" }),
        },
      };
    }
    if (page === maxDomainPages) break;
  }
  return { state: "unavailable", completeness: "partial", domains: [...domains.keys()].map((hostname) => ({ hostname, source: "custom-domain" })), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_PAGE_LIMIT" };
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
