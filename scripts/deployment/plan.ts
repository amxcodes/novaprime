import { createHash } from "node:crypto";
import type { LocalDeploymentInventory, RuntimeAdapter, SchedulerAdapter } from "./inventory.ts";
import type { ProviderResource } from "./providers.ts";
import { safeHostname } from "./providers/shared.ts";

export type DatabaseChange = "keep" | "provision-supabase" | "move";

export interface RequestedDeployment {
  runtime: RuntimeAdapter;
  database: DatabaseChange;
  scheduler: SchedulerAdapter | "keep";
}

export interface PlannedAction {
  id: string;
  resource: "source" | "runtime" | "database" | "scheduler" | "domain" | "secrets";
  operation: string;
  execution: "locally-verified" | "provider-inventory-required" | "not-implemented";
  reason?: string;
}

export interface DeploymentPreview {
  previewId: string;
  persisted: false;
  applyEnabled: false;
  request: RequestedDeployment;
  source: Pick<LocalDeploymentInventory["source"], "branch" | "commit" | "clean">;
  localHints: Pick<LocalDeploymentInventory, "runtimeHint" | "database" | "schedulerHint">;
  actions: PlannedAction[];
  blockers: string[];
  /** Operator attestation that the selected provider resources cover all NOVA triggers for this database. */
  schedulerScopeConfirmed: boolean;
  providerInventory?: ProviderResource[];
}

const netlifyRequiredRuntimeBindings = [
  { name: "DATABASE_URL", secret: true },
  { name: "BETTER_AUTH_SECRET", secret: true },
  { name: "BETTER_AUTH_URL", secret: false },
  { name: "NOVA_BOOTSTRAP_TOKEN", secret: true },
  { name: "NOVA_SECRETS_ENCRYPTION_KEY", secret: true },
  { name: "NOVA_BACKGROUND_JOB_SECRET", secret: true },
  { name: "NOVA_BACKGROUND_SCHEDULER", secret: false },
] as const;

const cloudflareRequiredRuntimeBindings = [
  { name: "HYPERDRIVE", type: "hyperdrive", secret: false },
  { name: "CF_VERSION_METADATA", type: "version_metadata", secret: false },
  { name: "BETTER_AUTH_SECRET", type: "secret_text", secret: true },
  { name: "BETTER_AUTH_URL", type: "plain_text", secret: false },
  { name: "NOVA_BOOTSTRAP_TOKEN", type: "secret_text", secret: true },
  { name: "NOVA_SECRETS_ENCRYPTION_KEY", type: "secret_text", secret: true },
  { name: "NOVA_BACKGROUND_JOB_SECRET", type: "secret_text", secret: true },
  { name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", secret: false },
] as const;

function runtimeConfigurationBlockers(
  runtime: RequestedDeployment["runtime"],
  expectedScheduler: string | null,
  inventory: ProviderResource["runtimeBindings"],
): string[] {
  if (!inventory || inventory.state !== "verified" || inventory.completeness !== "selected-runtime") {
    return ["TARGET_RUNTIME_BINDING_INVENTORY_INCOMPLETE"];
  }
  const required = runtime === "netlify" ? netlifyRequiredRuntimeBindings :
    runtime === "cloudflare" ? cloudflareRequiredRuntimeBindings : [];
  const blockers: string[] = [];
  for (const expected of required) {
    const binding = inventory.bindings.find(({ name }) => name === expected.name);
    if (!binding || binding.secret !== expected.secret ||
        (runtime === "netlify" && (!binding.scopes.includes("functions") ||
          !binding.contexts.some((context) => context === "all" || context === "production"))) ||
        (runtime === "cloudflare" && binding.type !== expected.type)) {
      blockers.push(`TARGET_RUNTIME_REQUIRED_BINDING_INVALID:${expected.name}`);
    }
  }
  if (expectedScheduler === null || inventory.configuredScheduler !== expectedScheduler) {
    blockers.push("TARGET_RUNTIME_SCHEDULER_CONFIGURATION_MISMATCH");
  }
  if (runtime === "netlify" && (inventory.buildSchedulerAvailable !== true ||
      inventory.configuredBuildScheduler !== expectedScheduler)) {
    blockers.push("TARGET_NETLIFY_BUILD_SCHEDULER_CONFIGURATION_MISMATCH");
  }
  return blockers;
}

function isRuntimeAdapter(value: string | undefined): value is RuntimeAdapter {
  return value === "netlify" || value === "cloudflare" || value === "vercel" || value === "vps";
}

function isSchedulerAdapter(value: string | undefined): value is SchedulerAdapter {
  return value === "cloudflare" || value === "netlify" || value === "vercel" || value === "supabase" || value === "vps";
}

function cloudflareRouteMayMatchHostname(pattern: string, hostname: string): boolean {
  const routeHostname = pattern.split("/", 1)[0]?.toLowerCase();
  if (!routeHostname) return true;
  if (!routeHostname.includes("*")) return routeHostname === hostname;
  const expression = routeHostname.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  try { return new RegExp(`^${expression}$`, "i").test(hostname); }
  catch { return true; }
}

function schedulerScopeBlockers(
  providerInventory: readonly ProviderResource[],
  currentRuntime: RuntimeAdapter | null,
  request: RequestedDeployment,
  currentScheduler: SchedulerAdapter | null,
  schedulerScopeConfirmed: boolean,
): string[] {
  const blockers: string[] = [];
  if (!schedulerScopeConfirmed) blockers.push("SCHEDULER_SCOPE_CONFIRMATION_REQUIRED");

  const selectedScheduler = request.scheduler === "keep" ? currentScheduler : request.scheduler;
  const required = new Set<string>();
  for (const runtime of [currentRuntime, request.runtime]) {
    if (runtime) required.add(runtime);
  }
  for (const scheduler of [currentScheduler, selectedScheduler]) {
    if (scheduler) required.add(scheduler);
  }

  const changingScheduler = request.scheduler !== "keep" && request.scheduler !== currentScheduler;
  for (const providerName of required) {
    const provider = providerInventory.find(({ provider: name }) => name === providerName);
    const scheduler = provider?.schedulerInventory;
    const expectedCompleteness = providerName === "cloudflare" ? "resource-only" : "project-scoped";
    if (provider?.state !== "identified" || !scheduler ||
        (scheduler.state !== "verified" && scheduler.state !== "not-installed") ||
        scheduler.completeness !== expectedCompleteness ||
        scheduler.triggers.some(({ active }) => active === null)) {
      blockers.push(`SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:${providerName}`);
      continue;
    }

    const activeCount = scheduler.triggers.filter(({ active }) => active === true).length;
    if (activeCount > 1) blockers.push(`DUPLICATE_${providerName.toUpperCase()}_SCHEDULER_TRIGGERS`);
    if (changingScheduler && selectedScheduler === providerName && currentScheduler !== providerName && activeCount > 0) {
      blockers.push(`TARGET_SCHEDULER_ALREADY_ACTIVE:${providerName}`);
    }
    if (changingScheduler && currentScheduler === providerName && activeCount !== 1) {
      blockers.push(`CONFIGURED_SCHEDULER_TRIGGER_COUNT_INVALID:${providerName}`);
    }
    if (!changingScheduler && selectedScheduler === providerName && activeCount !== 1) {
      blockers.push(`CONFIGURED_SCHEDULER_TRIGGER_COUNT_INVALID:${providerName}`);
    }
    if (selectedScheduler !== providerName && currentScheduler !== providerName && activeCount > 0) {
      blockers.push(`UNSELECTED_SCHEDULER_TRIGGER_PRESENT:${providerName}`);
    }
  }

  for (const providerName of ["cloudflare", "netlify", "vercel", "supabase", "vps"] as const) {
    if (required.has(providerName)) continue;
    const provider = providerInventory.find(({ provider: name }) => name === providerName);
    if (provider?.state === "identified" && provider.schedulerInventory?.triggers.some(({ active }) => active === true)) {
      blockers.push(`UNSELECTED_SCHEDULER_TRIGGER_PRESENT:${providerName}`);
    }
  }

  return blockers;
}

function isNetlifyCronToSupabaseStage(
  currentRuntime: RuntimeAdapter | null,
  currentScheduler: SchedulerAdapter | null,
  request: RequestedDeployment,
): boolean {
  return currentRuntime === "netlify" && currentScheduler === "netlify" &&
    request.runtime === "netlify" && request.database === "keep" && request.scheduler === "supabase";
}

function netlifyCronToSupabaseBlockers(providerInventory: readonly ProviderResource[]): string[] {
  const blockers: string[] = [];
  const netlify = providerInventory.find(({ provider }) => provider === "netlify");
  const sourceSchedules = netlify?.schedulerInventory;
  if (sourceSchedules?.state !== "verified" || sourceSchedules.completeness !== "project-scoped" ||
      sourceSchedules.triggers.length !== 1 || sourceSchedules.triggers[0]?.id !== "nova-background-tick" ||
      sourceSchedules.triggers[0]?.name !== "nova-background-tick" ||
      sourceSchedules.triggers[0]?.schedule !== "*/5 * * * *" || sourceSchedules.triggers[0]?.active !== true) {
    blockers.push("NETLIFY_SOURCE_CRON_NOT_EXACTLY_ONE_NOVA_TICK");
  }

  const bindings = netlify?.runtimeBindings;
  if (!bindings || bindings.state !== "verified" || bindings.completeness !== "selected-runtime") {
    blockers.push("NETLIFY_SOURCE_BINDING_INVENTORY_INCOMPLETE");
  } else {
    const functionSelector = bindings.bindings.find(({ name }) => name === "NOVA_BACKGROUND_SCHEDULER");
    if (!functionSelector || functionSelector.secret || !functionSelector.scopes.includes("functions") ||
        !functionSelector.contexts.some((context) => context === "all" || context === "production") ||
        bindings.configuredScheduler !== "netlify") blockers.push("NETLIFY_FUNCTION_SCHEDULER_SELECTOR_MISMATCH");
    if (bindings.buildSchedulerAvailable !== true) blockers.push("NETLIFY_BUILD_SCHEDULER_SELECTOR_UNAVAILABLE");
    else if (bindings.configuredBuildScheduler !== "netlify") blockers.push("NETLIFY_BUILD_SCHEDULER_SELECTOR_MISMATCH");
  }

  const liveIdentity = providerInventory.find(({ provider }) => provider === "nova");
  let verifiedOrigin = false;
  try {
    const origin = new URL(liveIdentity?.target ?? "");
    verifiedOrigin = liveIdentity?.state === "identified" && origin.protocol === "https:" &&
      !origin.username && !origin.password && origin.origin === liveIdentity?.target;
  } catch { /* The callback origin must come from the protected identity endpoint. */ }
  if (!verifiedOrigin) blockers.push("NOVA_PUBLIC_ORIGIN_UNVERIFIED");
  if (liveIdentity?.schemaReady !== true || liveIdentity.migrationLedgerPresent !== true) {
    blockers.push("LIVE_NOVA_SCHEMA_NOT_READY");
  }

  const supabaseSchedules = providerInventory.find(({ provider }) => provider === "supabase")?.schedulerInventory;
  if (supabaseSchedules?.state !== "not-installed" || supabaseSchedules.completeness !== "project-scoped" ||
      supabaseSchedules.triggers.length !== 0) {
    blockers.push("SUPABASE_CRON_TARGET_NOT_EMPTY_OR_UNVERIFIED");
  }
  return blockers;
}

export function buildDeploymentPreview(
  inventory: LocalDeploymentInventory,
  request: RequestedDeployment,
  providerInventory?: ProviderResource[],
  schedulerScopeConfirmed = false,
): DeploymentPreview {
  const blockers: string[] = [];
  const liveIdentity = providerInventory?.find(({ provider }) => provider === "nova");
  const liveRuntime = liveIdentity?.state === "identified" && isRuntimeAdapter(liveIdentity.runtime)
    ? liveIdentity.runtime
    : undefined;
  const liveScheduler = liveIdentity?.state === "identified" && isSchedulerAdapter(liveIdentity.configuredScheduler)
    ? liveIdentity.configuredScheduler
    : undefined;
  const currentRuntime = liveIdentity?.state === "identified"
    ? liveRuntime ?? inventory.runtimeHint
    : inventory.runtimeHint;
  const currentScheduler = liveIdentity?.state === "identified"
    ? liveScheduler ?? inventory.schedulerHint
    : inventory.schedulerHint;
  const runtimeChanges = currentRuntime !== request.runtime;
  const schedulerChanges = request.scheduler !== "keep" && request.scheduler !== currentScheduler;
  const stagedNetlifyCronToSupabase = isNetlifyCronToSupabaseStage(currentRuntime, currentScheduler, request);
  if (!inventory.source.clean) blockers.push("SOURCE_WORKTREE_NOT_CLEAN");
  if (request.database === "keep" && !inventory.database.configured) blockers.push("DATABASE_TARGET_NOT_CONFIGURED");
  if (request.database === "provision-supabase") blockers.push("SUPABASE_PROJECT_PROVISIONING_NOT_IMPLEMENTED");
  if (request.database === "move") blockers.push("DATABASE_MOVE_REQUIRES_MAINTENANCE_GATE_AND_REHEARSAL");
  if (currentRuntime === null) blockers.push("CURRENT_RUNTIME_NOT_IDENTIFIED");
  if (currentScheduler === null) blockers.push("CURRENT_SCHEDULER_NOT_IDENTIFIED");
  if (request.scheduler !== "keep" && currentScheduler !== null && request.scheduler !== currentScheduler &&
      !stagedNetlifyCronToSupabase) {
    blockers.push("CROSS_PROVIDER_SCHEDULER_INVENTORY_NOT_IMPLEMENTED");
  }
  if (providerInventory) {
    const runtimeState = providerInventory.find(({ provider }) => provider === request.runtime);
    if (runtimeState?.state !== "identified") blockers.push("TARGET_RUNTIME_NOT_VERIFIED");
    else if (!runtimeState.revision) blockers.push("TARGET_RUNTIME_REVISION_UNAVAILABLE");
    if (runtimeChanges && runtimeState?.state === "identified") {
      const expectedScheduler = request.scheduler === "keep" ? currentScheduler : request.scheduler;
      blockers.push(...runtimeConfigurationBlockers(request.runtime, expectedScheduler, runtimeState.runtimeBindings));
      if (runtimeState.domainRoutes?.state !== "verified" || runtimeState.domainRoutes.completeness !== "selected-runtime") {
        blockers.push("TARGET_RUNTIME_CUSTOM_DOMAIN_INVENTORY_INCOMPLETE");
      } else {
        const currentRuntimeResource = providerInventory.find(({ provider }) => provider === currentRuntime);
        const currentOrigin = (liveIdentity?.state === "identified" ? liveIdentity.origin : undefined) ?? currentRuntimeResource?.origin;
        const currentHostname = safeHostname(currentOrigin);
        if (!currentHostname) blockers.push("CURRENT_PUBLIC_HOSTNAME_UNVERIFIED");
        else if (!runtimeState.domainRoutes.domains.some(({ hostname }) => hostname === currentHostname)) {
          blockers.push("TARGET_RUNTIME_PUBLIC_HOSTNAME_NOT_ATTACHED");
        }
        if (request.runtime === "cloudflare") {
          const routing = runtimeState.domainRoutes.cloudflareRouting;
          if (routing?.state !== "verified" || routing.completeness !== "selected-runtime") {
            blockers.push("TARGET_CLOUDFLARE_ROUTE_DNS_INVENTORY_INCOMPLETE");
          } else {
            const domain = runtimeState.domainRoutes.domains.find(({ hostname }) => hostname === currentHostname);
            const zone = domain && routing.zones.find(({ hostnames }) => hostnames.includes(currentHostname));
            if (!domain || !zone || zone.state !== "verified") {
              blockers.push("TARGET_CLOUDFLARE_ZONE_FOR_PUBLIC_HOSTNAME_UNVERIFIED");
            } else {
              const targetWorker = runtimeState.target?.split("/").at(-1) ?? "";
              if (!zone.dnsRecords.some(({ hostname }) => hostname === currentHostname)) {
                blockers.push("TARGET_CLOUDFLARE_DNS_RECORD_NOT_VISIBLE");
              }
              if (zone.routes.some(({ pattern, script }) =>
                cloudflareRouteMayMatchHostname(pattern, currentHostname) && script !== targetWorker)) {
                blockers.push("TARGET_CLOUDFLARE_ROUTE_SHADOWS_PUBLIC_HOSTNAME");
              }
            }
          }
        }
      }
    }
    const databaseState = providerInventory.find(({ provider }) => provider === "supabase");
    if (request.database === "keep" && inventory.database.providerHint === "supabase" &&
        databaseState?.state !== "identified") {
      blockers.push("DATABASE_PROVIDER_NOT_VERIFIED");
    }
    if (request.database === "keep" && inventory.database.providerHint === "supabase" &&
        inventory.database.projectRef && databaseState?.state === "identified" && databaseState.target &&
        inventory.database.projectRef !== databaseState.target) {
      blockers.push("DATABASE_PROJECT_IDENTITY_MISMATCH");
    }
    if (request.database === "keep" && inventory.database.configured && liveIdentity?.state === "identified") {
      if (!inventory.database.identityFingerprint) blockers.push("LOCAL_DATABASE_IDENTITY_UNVERIFIABLE");
      else if (liveIdentity.databaseFingerprint &&
          liveIdentity.databaseFingerprint !== inventory.database.identityFingerprint) {
        blockers.push("LIVE_DATABASE_IDENTITY_MISMATCH");
      } else if (!liveIdentity.databaseFingerprint) {
        blockers.push("LIVE_DATABASE_IDENTITY_UNVERIFIED");
      }
    }
    if (runtimeChanges && request.database === "keep") {
      const migrationState = databaseState?.migrationInventory?.state;
      if (migrationState === "behind") blockers.push("DATABASE_MIGRATIONS_REQUIRED_BEFORE_RUNTIME_CHANGE");
      else if (migrationState === "ahead" || migrationState === "diverged") blockers.push("DATABASE_MIGRATION_HISTORY_DIVERGED");
      else if (migrationState !== "current") blockers.push("DATABASE_MIGRATION_STATE_UNVERIFIED");
    }
    if (request.scheduler !== "keep" &&
        providerInventory.find(({ provider }) => provider === request.scheduler)?.state !== "identified") {
      blockers.push("SCHEDULER_PROVIDER_NOT_VERIFIED");
    }
    if (stagedNetlifyCronToSupabase) blockers.push(...netlifyCronToSupabaseBlockers(providerInventory));
    if (liveIdentity?.state !== "identified") {
      blockers.push("LIVE_NOVA_IDENTITY_NOT_VERIFIED");
    } else {
      if (inventory.runtimeHint && liveIdentity.runtime && liveIdentity.runtime !== inventory.runtimeHint) {
        blockers.push("LOCAL_RUNTIME_HINT_DIFFERS_FROM_LIVE_RUNTIME");
      }
      if (inventory.schedulerHint && liveIdentity.configuredScheduler && liveIdentity.configuredScheduler !== inventory.schedulerHint) {
        blockers.push("LOCAL_SCHEDULER_HINT_DIFFERS_FROM_LIVE_SCHEDULER");
      }
    }
    blockers.push(...schedulerScopeBlockers(providerInventory, currentRuntime, request, currentScheduler, schedulerScopeConfirmed));
  } else {
    blockers.push("GLOBAL_SCHEDULER_INVENTORY_NOT_REQUESTED");
  }

  const actions: PlannedAction[] = [
    { id: "bind-source-snapshot", resource: "source", operation: "record commit and worktree state", execution: "locally-verified" },
  ];
  if (!providerInventory) {
    actions.push(
      { id: "discover-current-runtime", resource: "runtime", operation: "inspect deployed provider/account/project and live commit", execution: "provider-inventory-required" },
      { id: "discover-current-database", resource: "database", operation: "verify exact live database identity and migration head", execution: "provider-inventory-required" },
      { id: "inventory-schedulers", resource: "scheduler", operation: "identify every runtime/scheduler resource that can call this database and verify each trigger", execution: "provider-inventory-required" },
    );
  }
  if (request.database === "keep") {
    actions.push({ id: "preserve-database", resource: "database", operation: "verify and preserve the selected database without changes", execution: "provider-inventory-required" });
  } else if (request.database === "provision-supabase") {
    actions.push({ id: "provision-database", resource: "database", operation: "create an empty Supabase project and bootstrap NOVA", execution: "not-implemented" });
  } else {
    actions.push({ id: "move-database", resource: "database", operation: "freeze, copy, validate and cut over PostgreSQL data", execution: "not-implemented", reason: "Requires a global write-maintenance gate and rehearsed restore path." });
  }
  if (runtimeChanges) {
    actions.push(
      { id: "compare-runtime-secrets", resource: "secrets", operation: "compare required key presence without revealing values", execution: "provider-inventory-required" },
      { id: "verify-domain-control", resource: "domain", operation: "verify origin, DNS zone ownership, route and TLS", execution: "provider-inventory-required" },
      { id: "deploy-candidate", resource: "runtime", operation: "deploy " + request.runtime + " candidate and verify identity", execution: "not-implemented" },
    );
  } else {
    actions.push({ id: "verify-runtime", resource: "runtime", operation: "confirm the existing " + request.runtime + " runtime remains healthy", execution: "provider-inventory-required" });
  }
  if (stagedNetlifyCronToSupabase) {
    actions.push(
      {
        id: "deploy-netlify-api-only",
        resource: "runtime",
        operation: "set the Netlify Build and Functions scheduler selectors to supabase, deploy the API-only function set, and verify the published deploy has no NOVA scheduled function",
        execution: "not-implemented",
        reason: "This stage disables Netlify Cron before any Supabase Cron job is created, avoiding overlap.",
      },
      {
        id: "create-supabase-cron",
        resource: "scheduler",
        operation: "create exactly one named nova-background-tick job for the selected Supabase database and verified HTTPS NOVA origin",
        execution: "not-implemented",
        reason: "Run the existing bun run supabase:scheduler command from a trusted operator checkout after the API-only Netlify deploy is verified.",
      },
      {
        id: "verify-supabase-cron",
        resource: "scheduler",
        operation: "verify exactly one active Supabase job and a successful tick in cron.job_run_details and net._http_response",
        execution: "not-implemented",
      },
    );
  } else if (schedulerChanges) {
    actions.push({ id: "handover-scheduler", resource: "scheduler", operation: "hand over to " + request.scheduler, execution: "not-implemented" });
  } else if (runtimeChanges && currentScheduler === "supabase" && request.database === "keep") {
    actions.push({
      id: "repoint-supabase-cron",
      resource: "scheduler",
      operation: "preserve the Supabase Cron callback when the public origin stays the same; otherwise update it to the verified candidate HTTPS origin",
      execution: "not-implemented",
      reason: "The current job stores its callback origin in Supabase Vault. A stable origin follows the new route automatically; a changed origin requires updating the existing job, then verifying one active job and its pg_net response before retiring the old runtime.",
    });
  } else {
    actions.push({ id: "verify-scheduler", resource: "scheduler", operation: "verify and retain the currently selected scheduler", execution: "provider-inventory-required" });
  }
  if (runtimeChanges) {
    actions.push({ id: "promote-origin", resource: "domain", operation: "promote the reviewed hostname after candidate and scheduler verification", execution: "not-implemented" });
  }

  const identity = JSON.stringify({ request, schedulerScopeConfirmed, source: inventory.source, localHints: {
    runtimeHint: inventory.runtimeHint,
    database: inventory.database,
    schedulerHint: inventory.schedulerHint,
  }, providerInventory });
  const previewId = "preview-" + createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return {
    previewId,
    persisted: false,
    applyEnabled: false,
    request,
    source: { branch: inventory.source.branch, commit: inventory.source.commit, clean: inventory.source.clean },
    localHints: { runtimeHint: inventory.runtimeHint, database: inventory.database, schedulerHint: inventory.schedulerHint },
    actions,
    blockers: [...new Set(blockers)],
    schedulerScopeConfirmed,
    ...(providerInventory ? { providerInventory } : {}),
  };
}
