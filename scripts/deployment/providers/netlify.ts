import type { DomainRouteInventory, ProviderFetcher, ProviderResource, RuntimeBindingInventory, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHostname, safeHttpsOrigin, safeProviderId, safeReleaseSha, safeSchedulerSelector } from "./shared.ts";

const maxEnvironmentVariables = 500;

function productionBindings(value: unknown): RuntimeBindingInventory {
  if (!Array.isArray(value) || value.length > maxEnvironmentVariables) {
    return { state: "unavailable", completeness: "partial", bindings: [], detail: "NETLIFY_PRODUCTION_VARIABLE_INVENTORY_INVALID" };
  }
  const bindings: RuntimeBindingInventory["bindings"] = [];
  let configuredScheduler: string | undefined;
  const seen = new Set<string>();
  for (const entry of value) {
    const variable = asObject(entry);
    const name = firstString(variable?.key);
    const scopes = variable?.scopes;
    const values = variable?.values;
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || seen.has(name) ||
        !Array.isArray(scopes) || scopes.length > 8 || !Array.isArray(values) || values.length > 32 ||
        values.some((item) => {
          const object = asObject(item);
          return !object || !["all", "production"].includes(String(object.context));
        })) {
      return { state: "unavailable", completeness: "partial", bindings: [], detail: "NETLIFY_PRODUCTION_VARIABLE_INVENTORY_INVALID" };
    }
    seen.add(name);
    const normalizedScopes = scopes.filter((scope): scope is string =>
      typeof scope === "string" && ["builds", "functions", "runtime", "post-processing"].includes(scope));
    if (normalizedScopes.length !== scopes.length) {
      return { state: "unavailable", completeness: "partial", bindings: [], detail: "NETLIFY_PRODUCTION_VARIABLE_SCOPE_INVALID" };
    }
    const contexts = [...new Set(values.map((item) => String(asObject(item)?.context)))].sort();
    if (name === "NOVA_BACKGROUND_SCHEDULER") {
      const candidates = new Set(values.map((item) => safeSchedulerSelector(asObject(item)?.value)).filter(Boolean));
      if (candidates.size === 1) configuredScheduler = [...candidates][0];
    }
    bindings.push({ name, type: "environment-variable", scopes: [...new Set(normalizedScopes)].sort(), contexts, secret: variable?.is_secret === true });
  }
  return {
    state: "verified", completeness: "selected-runtime", bindings: bindings.sort((left, right) => left.name.localeCompare(right.name)),
    ...(configuredScheduler ? { configuredScheduler } : {}),
  };
}

function netlifyBuildScheduler(value: unknown): Pick<RuntimeBindingInventory, "buildSchedulerAvailable" | "configuredBuildScheduler"> {
  const inventory = productionBindings(value);
  const binding = inventory.bindings.find(({ name }) => name === "NOVA_BACKGROUND_SCHEDULER");
  const available = inventory.state === "verified" && binding !== undefined && binding.secret === false &&
    binding.scopes.includes("builds") && binding.contexts.some((context) => context === "all" || context === "production") &&
    Boolean(inventory.configuredScheduler);
  return {
    buildSchedulerAvailable: available,
    ...(available && inventory.configuredScheduler ? { configuredBuildScheduler: inventory.configuredScheduler } : {}),
  };
}

function siteDomains(site: Record<string, unknown>): DomainRouteInventory {
  if (!Array.isArray(site.domain_aliases) || !Object.hasOwn(site, "custom_domain")) {
    return { state: "unavailable", completeness: "partial", domains: [], detail: "NETLIFY_SITE_DOMAIN_INVENTORY_INCOMPLETE" };
  }
  const domains = new Map<string, DomainRouteInventory["domains"][number]>();
  const add = (value: unknown, source: DomainRouteInventory["domains"][number]["source"]) => {
    const hostname = safeHostname(value);
    if (!hostname) return value === null || value === undefined || value === "";
    const existing = domains.get(hostname);
    if (!existing || source === "custom-domain") domains.set(hostname, { hostname, source });
    return true;
  };
  const valid = add(site.custom_domain, "custom-domain") && site.domain_aliases.every((value) => add(value, "custom-domain")) &&
    add(site.url, "provider-default") && add(site.ssl_url, "provider-default");
  if (!valid) return { state: "unavailable", completeness: "partial", domains: [], detail: "NETLIFY_SITE_DOMAIN_INVENTORY_INVALID" };
  return { state: "verified", completeness: "selected-runtime", domains: [...domains.values()].sort((left, right) => left.hostname.localeCompare(right.hostname)) };
}

function inventoryError(error: unknown): string {
  return providerFailure("netlify", error).detail ?? "PROVIDER_READ_FAILED";
}

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
    const runtimeBindings = await (async (): Promise<RuntimeBindingInventory> => {
      const accountId = safeProviderId(firstString(site.account_id));
      if (!accountId) return { state: "unavailable", completeness: "partial", bindings: [], detail: "NETLIFY_ACCOUNT_ID_UNAVAILABLE" };
      try {
        const readScope = async (scope: "builds" | "functions") => {
          const query = new URLSearchParams({ site_id: id, context_name: "production", scope });
          return await getProviderJson<unknown>(fetcher,
            `https://api.netlify.com/api/v1/accounts/${encodeURIComponent(accountId)}/env?${query}`, token, "netlify");
        };
        const [functionsVariables, buildVariables] = await Promise.all([readScope("functions"), readScope("builds")]);
        const functions = productionBindings(functionsVariables);
        const build = netlifyBuildScheduler(buildVariables);
        if (functions.state !== "verified") return functions;
        return {
          ...functions,
          ...build,
        };
      } catch (error) {
        return { state: "unavailable", completeness: "partial", bindings: [], detail: inventoryError(error) };
      }
    })();
    return {
      provider: "netlify", state: "identified", target: id, runtime: "netlify",
      ...(revision ? { revision } : {}),
      ...(safeReleaseSha(firstString(latestProduction?.commit_sha, latestProduction?.commit_ref, latestProduction?.commit))
        ? { release: safeReleaseSha(firstString(latestProduction?.commit_sha, latestProduction?.commit_ref, latestProduction?.commit)) } : {}),
      ...(safeHttpsOrigin(firstString(site.ssl_url, site.url)) ? { origin: safeHttpsOrigin(firstString(site.ssl_url, site.url)) } : {}),
      schedulerInventory: publishedFunctionSchedules(latestProduction),
      runtimeBindings,
      domainRoutes: siteDomains(site),
      detail: latestProduction ? "PRODUCTION_DEPLOY_READY" : "PRODUCTION_DEPLOY_NOT_CONFIRMED",
    };
  } catch (error) { return providerFailure("netlify", error); }
}
