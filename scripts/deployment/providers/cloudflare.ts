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

function restrictedAccessPolicySet(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const policies = value.map(asObject);
  if (policies.some((policy) => !policy || !["allow", "deny"].includes(String(policy.decision)))) return false;
  const allows = policies.filter((policy) => policy?.decision === "allow");
  return allows.length > 0 && allows.every((policy) =>
    Array.isArray(policy?.include) && policy.include.length > 0 &&
    policy.include.every((rule) => {
      const entry = asObject(rule);
      const keys = entry ? Object.keys(entry) : [];
      if (keys.length !== 1) return false;
      const value = asObject(entry?.[keys[0]!]);
      if (keys[0] !== "email" || typeof value?.email !== "string" || value.email.length > 254) return false;
      const separator = value.email.lastIndexOf("@");
      const local = value.email.slice(0, separator);
      const domain = value.email.slice(separator + 1);
      return separator > 0 && local.length <= 64 && !/[\s@]/.test(local) && !!safeHostname(domain);
    }));
}

function candidateVersionHostMatches(uri: string | undefined, worker: string, subdomain: string): boolean | null {
  if (!uri || uri.length > 2_000) return null;
  const schemeEnd = uri.indexOf("://");
  const authority = (schemeEnd >= 0 ? uri.slice(schemeEnd + 3) : uri).split(/[/?#]/, 1)[0];
  if (!authority || authority.length > 512 || /[@:\u0000-\u0020]/.test(authority)) return null;
  const normalized = authority.toLowerCase();
  const normalizedWorker = worker.toLowerCase();
  const candidateSuffix = "." + subdomain.toLowerCase() + ".workers.dev";
  const candidateLabelSuffix = "-" + normalizedWorker;
  const candidate = "nova-candidate-probe-" + normalizedWorker + candidateSuffix;
  const firstLabel = normalized.split(".", 1)[0] ?? "";
  const exactAccountSuffix = normalized.endsWith(candidateSuffix);
  const wildcardAccountSuffix = !exactAccountSuffix && normalized.endsWith(".workers.dev") &&
    normalized.slice(firstLabel.length).includes("*");
  if (!exactAccountSuffix && !wildcardAccountSuffix) return false;
  const escaped = normalized.split("*").map((part) => part.split("").map((character) =>
    ".+?^$(){}|[]\\".includes(character) ? "\\" + character : character).join("")).join(".*");
  try {
    const pattern = new RegExp("^" + escaped + "$");
    if (pattern.test(candidate)) {
      // A host glob that matches this Worker is an overlapping destination;
      // exact synthetic labels remain ambiguous rather than being called safe.
      return firstLabel.includes("*") ? true : null;
    }
    const wildcardTail = firstLabel.includes("*") ? firstLabel.slice(firstLabel.lastIndexOf("*") + 1) : null;
    if (wildcardTail !== null) {
      // The wildcard can cover a version prefix if its fixed tail is compatible
      // with the selected Worker's version-host suffix.
      return candidateLabelSuffix.endsWith(wildcardTail) ? true : false;
    }
    if (!firstLabel.endsWith(candidateLabelSuffix)) return false;
    const versionPrefix = firstLabel.slice(0, -candidateLabelSuffix.length);
    // An exact non-empty version prefix is ambiguous before candidate creation.
    return versionPrefix.length > 0 ? null : false;
  }
  catch { return null; }
}

function inspectCandidateAccessApplications(
  apps: readonly unknown[],
  workerId: string,
  worker: string,
  subdomain: string,
): {
  relevantApplications: Array<{ id: string; type: string }>;
  targetPreviewApplications: Array<{ id: string; type: string }>;
  publicDestinationOverrides: "none" | "present" | "unverified";
  unverified: boolean;
} {
  const relevantApplications = new Map<string, { id: string; type: string }>();
  const targetPreviewApplications = new Map<string, { id: string; type: string }>();
  let publicDestinationOverrides: "none" | "present" | "unverified" = "none";
  let unverified = false;
  for (const value of apps) {
    const app = asObject(value);
    if (!app) { unverified = true; continue; }
    if (!Array.isArray(app.destinations)) {
      const legacyDomains = [firstString(app.domain), ...(Array.isArray(app.self_hosted_domains)
        ? app.self_hosted_domains.map((item) => firstString(asObject(item)?.hostname ?? item)) : [])];
      if (legacyDomains.some((domain) => domain?.toLowerCase().includes("workers.dev") &&
          candidateVersionHostMatches(domain, worker, subdomain) !== false)) unverified = true;
      continue;
    }
    let relevant = false;
    const appId = safeProviderId(firstString(app.id));
    const appType = firstString(app.type);
    for (const item of app.destinations) {
      const destination = asObject(item);
      if (!destination) { unverified = true; continue; }
      const type = destination.type;
      if ((type === "preview_worker" || type === "worker") && typeof destination.worker_id !== "string") {
        unverified = true;
        continue;
      }
      const targetsPreviewWorker = type === "preview_worker" && destination.worker_id === workerId;
      const targetsWorker = type === "worker" && destination.worker_id === workerId;
      const targetsPreviewSet = type === "all_preview_workers" || type === "all_workers";
      const publicHostMatches = destination.type === "public"
        ? candidateVersionHostMatches(firstString(destination.uri), worker, subdomain)
        : false;
      if (publicHostMatches === null) { unverified = true; continue; }
      if (!targetsPreviewWorker && !targetsWorker && !targetsPreviewSet && !publicHostMatches) continue;
      relevant = true;
      if (targetsPreviewWorker && appId && appType) targetPreviewApplications.set(appId, { id: appId, type: appType });
      if (destination.overrides !== undefined && !Array.isArray(destination.overrides)) {
        publicDestinationOverrides = "unverified";
        continue;
      }
      for (const overrideItem of (Array.isArray(destination.overrides) ? destination.overrides : [])) {
        const override = asObject(overrideItem);
        if (!override || typeof override.behavior !== "string" || typeof override.path_pattern !== "string") {
          publicDestinationOverrides = "unverified";
          continue;
        }
        if (override.behavior === "public") publicDestinationOverrides = "present";
        else publicDestinationOverrides = "unverified";
      }
    }
    if (relevant) {
      if (!appId || !appType || appType !== "self_hosted") unverified = true;
      else relevantApplications.set(appId, { id: appId, type: appType });
    }
  }
  return {
    relevantApplications: [...relevantApplications.values()],
    targetPreviewApplications: [...targetPreviewApplications.values()],
    publicDestinationOverrides,
    unverified,
  };
}

async function inspectCandidateAccessProtection(
  account: string,
  worker: string,
  token: string,
  fetcher: ProviderFetcher,
): Promise<{
  protection: NonNullable<ProviderResource["candidateAccessProtection"]>;
  runtimeId?: string;
}> {
  let previewUrlsEnabled: boolean | null = null;
  let workerScopedPolicy: "verified" | "missing" | "unsafe" | "unverified" = "unverified";
  let publicDestinationOverrides: "none" | "present" | "unverified" = "unverified";
  try {
    const workers = await cloudflarePages((page) => {
      const query = new URLSearchParams({ page: String(page), per_page: String(routesPerPage) });
      return "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/workers/workers?" + query;
    }, token, fetcher, "WORKER_ID_INVENTORY_INVALID");
    const matchingWorkers = workers.map(asObject).filter((item) => item?.name === worker);
    const runtimeId = matchingWorkers.length === 1 ? safeProviderId(firstString(matchingWorkers[0]?.id)) : undefined;
    if (!runtimeId) throw new Error("cloudflare:WORKER_ID_UNVERIFIED");

    const subdomainResponse = asObject(await getProviderJson(fetcher,
      "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) +
      "/workers/scripts/" + encodeURIComponent(worker) + "/subdomain", token, "cloudflare"));
    const subdomainSettings = asObject(subdomainResponse?.result);
    if (!subdomainResponse?.success || typeof subdomainSettings?.enabled !== "boolean" ||
        typeof subdomainSettings.previews_enabled !== "boolean") {
      throw new Error("cloudflare:PREVIEW_URL_SETTINGS_UNVERIFIED");
    }
    previewUrlsEnabled = subdomainSettings.previews_enabled;
    const accountSubdomainResponse = asObject(await getProviderJson(fetcher,
      "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/workers/subdomain", token, "cloudflare"));
    const accountSubdomain = asObject(accountSubdomainResponse?.result);
    if (!accountSubdomainResponse?.success) throw new Error("cloudflare:WORKERS_DEV_SUBDOMAIN_UNVERIFIED");
    const subdomain = firstString(accountSubdomain?.subdomain);
    if (!subdomain || !safeHostname(worker + "." + subdomain + ".workers.dev")) {
      throw new Error("cloudflare:WORKERS_DEV_SUBDOMAIN_UNVERIFIED");
    }

    const apps = await cloudflarePages((page) => {
      const query = new URLSearchParams({ page: String(page), per_page: String(routesPerPage) });
      return "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/access/apps?" + query;
    }, token, fetcher, "ACCESS_APPLICATION_INVENTORY_INVALID");
    const accessApps = inspectCandidateAccessApplications(apps, runtimeId, worker, subdomain);
    if (accessApps.unverified) throw new Error("cloudflare:ACCESS_APPLICATION_SCOPE_UNVERIFIED");
    if (accessApps.targetPreviewApplications.length === 1 && accessApps.relevantApplications.length > 0) {
      const policiesByApplication = await Promise.all(accessApps.relevantApplications.map(async ({ id }) => {
        const applicationId = safeProviderId(id);
        if (!applicationId) throw new Error("cloudflare:ACCESS_APPLICATION_ID_UNVERIFIED");
        return cloudflarePages((page) => {
          const query = new URLSearchParams({ page: String(page), per_page: String(routesPerPage) });
          return "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) +
            "/access/apps/" + encodeURIComponent(applicationId) + "/policies?" + query;
        }, token, fetcher, "ACCESS_POLICY_INVENTORY_INVALID");
      }));
      workerScopedPolicy = policiesByApplication.every(restrictedAccessPolicySet) ? "verified" : "unsafe";
    } else {
      workerScopedPolicy = accessApps.targetPreviewApplications.length === 0 ? "missing" : "unverified";
    }
    publicDestinationOverrides = accessApps.publicDestinationOverrides;
    const state = previewUrlsEnabled && workerScopedPolicy === "verified" && publicDestinationOverrides === "none"
      ? "verified" : "unavailable";
    return { protection: { state, previewUrlsEnabled, workerScopedPolicy, publicDestinationOverrides }, runtimeId };
  } catch (error) {
    return {
      protection: {
        state: "unavailable",
        previewUrlsEnabled,
        workerScopedPolicy,
        publicDestinationOverrides,
        detail: providerFailure("cloudflare", error).detail,
      },
    };
  }
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
    const [schedulerInventory, settings, domainRoutes, candidateAccess] = await Promise.all([
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
      inspectCandidateAccessProtection(account, worker, token, fetcher),
    ]);
    const revision = safeProviderId(firstString(script.etag, script.modified_on));
    return {
      provider: "cloudflare", state: "identified", target: `${account}/${worker}`, runtime: "cloudflare",
      ...(revision ? { revision } : {}),
      ...(candidateAccess.runtimeId ? { runtimeId: candidateAccess.runtimeId } : {}),
      schedulerInventory,
      runtimeBindings: settings,
      candidateAccessProtection: candidateAccess.protection,
      domainRoutes,
      ...(firstString(script.modified_on) ? { detail: `SCRIPT_MODIFIED_${script.modified_on}` } : {}),
    };
  } catch (error) { return providerFailure("cloudflare", error); }
}
