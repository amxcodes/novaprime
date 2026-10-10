import type { DomainRouteInventory, ProviderFetcher, ProviderResource, RuntimeBindingInventory, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHostname, safeProviderId, safeSchedulerSelector } from "./shared.ts";
import { databaseIdentityFingerprint } from "../../../server/src/deployment-identity.ts";

const domainsPerPage = 100;
const maxDomainPages = 20;
const maxRoutingDomains = 12;
const routesPerPage = 100;
const maxRoutePages = 20;
const maxDnsPages = 2;

interface WorkerDomain { hostname: string; zoneId: string; enabled: boolean }

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
    const resourceId = name === "HYPERDRIVE" && type === "hyperdrive"
      ? safeProviderId(firstString(binding?.id))
      : undefined;
    if (name === "HYPERDRIVE" && type === "hyperdrive" && !resourceId) {
      return { state: "unavailable", completeness: "partial", bindings: [], detail: "CLOUDFLARE_HYPERDRIVE_ID_UNAVAILABLE" };
    }
    bindings.push({ name, type, ...(resourceId ? { resourceId } : {}), scopes: ["worker"], contexts: ["production"], secret: type.startsWith("secret") });
  }
  return {
    state: "verified", completeness: "selected-runtime", bindings: bindings.sort((left, right) => left.name.localeCompare(right.name)),
    ...(configuredScheduler ? { configuredScheduler } : {}),
  };
}

function supabaseProjectRef(connection: URL): string | undefined {
  const directRef = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(connection.hostname)?.[1]?.toLowerCase();
  const poolerRef = connection.hostname.toLowerCase().endsWith(".pooler.supabase.com")
    ? decodeURIComponent(connection.username).toLowerCase().split(".").at(-1)
    : undefined;
  const projectRef = directRef ?? poolerRef;
  return projectRef && /^[a-z0-9]{20}$/.test(projectRef) ? projectRef : undefined;
}

function cloudflareHyperdriveTarget(
  configuration: unknown,
  configurationId: string,
  environment: Readonly<Record<string, string>>,
): NonNullable<RuntimeBindingInventory["hyperdrive"]> {
  const unverified = { configurationId, databaseTarget: "unverified" as const, runtimeRole: "unverified" as const };
  try {
    const result = asObject(configuration);
    const origin = asObject(result?.origin);
    if (result?.id !== configurationId || !origin) return unverified;

    const expectedConnection = new URL(environment.DATABASE_URL ?? "");
    const targetHost = safeHostname(origin.host);
    const targetUser = firstString(origin.user);
    const targetDatabase = firstString(origin.database);
    const targetScheme = firstString(origin.scheme);
    const targetPort = origin.port === undefined ? 5432 : origin.port;
    if ((expectedConnection.protocol !== "postgres:" && expectedConnection.protocol !== "postgresql:") ||
        !targetHost || !targetUser || !targetDatabase || !["postgres", "postgresql"].includes(targetScheme ?? "") || !Number.isInteger(targetPort) ||
        (targetPort as number) < 1 || (targetPort as number) > 65535) return unverified;

    const projectRef = supabaseProjectRef(expectedConnection);
    const configuredRef = environment.NOVA_SUPABASE_PROJECT_REF;
    if (configuredRef && projectRef && configuredRef.toLowerCase() !== projectRef) return unverified;
    const targetConnection = new URL(`postgresql://${encodeURIComponent(targetUser)}@${targetHost}:${targetPort}/${encodeURIComponent(targetDatabase)}`);
    const expectedFingerprint = databaseIdentityFingerprint(expectedConnection.toString(), configuredRef);
    const targetProjectRef = supabaseProjectRef(targetConnection);
    const targetFingerprint = databaseIdentityFingerprint(targetConnection.toString(), targetProjectRef ?? configuredRef);
    const expectedUser = decodeURIComponent(expectedConnection.username).toLowerCase().split(".", 1)[0];
    const actualUser = decodeURIComponent(targetConnection.username).toLowerCase().split(".", 1)[0];
    return {
      configurationId,
      databaseTarget: expectedFingerprint && targetFingerprint
        ? expectedFingerprint === targetFingerprint ? "verified" : "mismatch"
        : "unverified",
      runtimeRole: expectedUser === "nova_app" && actualUser === "nova_app"
        ? "verified"
        : expectedUser && actualUser ? "invalid" : "unverified",
    };
  } catch {
    return unverified;
  }
}

async function inspectHyperdrive(
  account: string,
  binding: RuntimeBindingInventory["bindings"][number] | undefined,
  token: string,
  fetcher: ProviderFetcher,
  environment: Readonly<Record<string, string>>,
): Promise<RuntimeBindingInventory["hyperdrive"]> {
  if (!binding || binding.name !== "HYPERDRIVE" || binding.type !== "hyperdrive" || !binding.resourceId) return undefined;
  try {
    const response = await getProviderJson(fetcher,
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/hyperdrive/configs/${encodeURIComponent(binding.resourceId)}`,
      token, "cloudflare");
    const envelope = asObject(response);
    if (!envelope?.success) return { configurationId: binding.resourceId, databaseTarget: "unverified", runtimeRole: "unverified" };
    return cloudflareHyperdriveTarget(envelope.result, binding.resourceId, environment);
  } catch {
    return { configurationId: binding.resourceId, databaseTarget: "unverified", runtimeRole: "unverified" };
  }
}

async function workerDomains(
  account: string,
  worker: string,
  token: string,
  fetcher: ProviderFetcher,
): Promise<DomainRouteInventory> {
  const domains = new Map<string, WorkerDomain>();
  const discoveredDomains = () => [...domains.values()].map(({ hostname, enabled }) => ({ hostname, enabled, source: "custom-domain" as const }));
  let expectedPages: number | undefined;
  for (let page = 1; page <= maxDomainPages; page += 1) {
    const query = new URLSearchParams({ service: worker, page: String(page), per_page: String(domainsPerPage) });
    let envelope: Record<string, unknown> | null;
    try {
      envelope = asObject(await getProviderJson(fetcher,
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/domains?${query}`, token, "cloudflare"));
    } catch (error) {
      return { state: "unavailable", completeness: "partial", domains: discoveredDomains(), detail: providerFailure("cloudflare", error).detail };
    }
    const result = envelope && Array.isArray(envelope.result) ? envelope.result : null;
    const resultInfo = asObject(envelope?.result_info);
    const totalPages = resultInfo?.total_pages;
    if (!envelope?.success || !result || !Number.isInteger(totalPages) || (totalPages as number) < 0 || !resultInfo ||
        (resultInfo.page !== undefined && resultInfo.page !== page)) {
      return { state: "unavailable", completeness: "partial", domains: discoveredDomains(), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
    }
    if (totalPages === 0) {
      if (page !== 1 || result.length !== 0 || domains.size !== 0) {
        return { state: "unavailable", completeness: "partial", domains: discoveredDomains(), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
      }
      return {
        state: "verified", completeness: "selected-runtime", domains: [],
        cloudflareRouting: { state: "verified", completeness: "selected-runtime", zones: [] },
      };
    }
    if (expectedPages === undefined) expectedPages = totalPages as number;
    if (expectedPages !== totalPages) {
      return { state: "unavailable", completeness: "partial", domains: discoveredDomains(), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_CHANGED_DURING_READ" };
    }
    for (const entry of result) {
      const domain = asObject(entry);
      const service = firstString(domain?.service);
      const hostname = safeHostname(domain?.hostname);
      const zoneId = firstString(domain?.zone_id);
      const enabled = domain?.enabled;
      if (service !== worker || !hostname || !zoneId || !/^[a-f0-9]{32}$/i.test(zoneId) ||
          typeof enabled !== "boolean" || domains.has(hostname)) {
        return { state: "unavailable", completeness: "partial", domains: discoveredDomains(), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_INVALID" };
      }
      domains.set(hostname, { hostname, zoneId: zoneId.toLowerCase(), enabled });
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
          domains: selectedDomains.map(({ hostname, enabled }) => ({ hostname, enabled, source: "custom-domain" })),
          cloudflareRouting: { state: "unavailable", completeness: "partial", zones: [], detail: "CLOUDFLARE_ROUTING_DOMAIN_LIMIT" },
        };
      }
      const zoneEvidence = await Promise.all([...domainsByZone].map(([zoneId, hostnames]) => zoneRouting(zoneId, hostnames, token, fetcher)));
      const routingComplete = zoneEvidence.every(({ state }) => state === "verified");
      return {
        state: "verified", completeness: "selected-runtime",
        domains: selectedDomains.map(({ hostname, enabled }) => ({ hostname, enabled, source: "custom-domain" })),
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
  return { state: "unavailable", completeness: "partial", domains: discoveredDomains(), detail: "CLOUDFLARE_WORKER_DOMAIN_INVENTORY_PAGE_LIMIT" };
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
          const inventory = cloudflareBindings(result.bindings);
          if (inventory.state !== "verified") return inventory;
          const hyperdrive = await inspectHyperdrive(account, inventory.bindings.find(({ name }) => name === "HYPERDRIVE"), token, fetcher, environment);
          return { ...inventory, ...(hyperdrive ? { hyperdrive } : {}) };
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
