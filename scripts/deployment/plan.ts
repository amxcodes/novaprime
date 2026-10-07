import { createHash } from "node:crypto";
import type { LocalDeploymentInventory, RuntimeAdapter, SchedulerAdapter } from "./inventory.ts";
import type { ProviderResource } from "./providers.ts";

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
  providerInventory?: ProviderResource[];
}

export function buildDeploymentPreview(
  inventory: LocalDeploymentInventory,
  request: RequestedDeployment,
  providerInventory?: ProviderResource[],
): DeploymentPreview {
  const blockers: string[] = [];
  const liveIdentity = providerInventory?.find(({ provider }) => provider === "nova");
  const currentRuntime = liveIdentity?.state === "identified"
    ? liveIdentity.runtime ?? inventory.runtimeHint
    : inventory.runtimeHint;
  const currentScheduler = liveIdentity?.state === "identified"
    ? liveIdentity.configuredScheduler ?? inventory.schedulerHint
    : inventory.schedulerHint;
  const runtimeChanges = currentRuntime !== request.runtime;
  const schedulerChanges = request.scheduler !== "keep" && request.scheduler !== currentScheduler;
  if (!inventory.source.clean) blockers.push("SOURCE_WORKTREE_NOT_CLEAN");
  if (request.database === "keep" && !inventory.database.configured) blockers.push("DATABASE_TARGET_NOT_CONFIGURED");
  if (request.database === "provision-supabase") blockers.push("SUPABASE_PROJECT_PROVISIONING_NOT_IMPLEMENTED");
  if (request.database === "move") blockers.push("DATABASE_MOVE_REQUIRES_MAINTENANCE_GATE_AND_REHEARSAL");
  if (inventory.runtimeHint === null) blockers.push("CURRENT_RUNTIME_NOT_IDENTIFIED");
  if (inventory.schedulerHint === null) blockers.push("CURRENT_SCHEDULER_NOT_IDENTIFIED");
  if (request.scheduler === "keep" && inventory.schedulerHint === null) {
    blockers.push("CURRENT_SCHEDULER_NOT_IDENTIFIED");
  } else if (request.scheduler !== "keep" && request.scheduler !== inventory.schedulerHint) {
    blockers.push("CROSS_PROVIDER_SCHEDULER_INVENTORY_NOT_IMPLEMENTED");
  }
  if (providerInventory) {
    const runtimeState = providerInventory.find(({ provider }) => provider === request.runtime);
    if (runtimeState?.state !== "identified") blockers.push("TARGET_RUNTIME_NOT_VERIFIED");
    const databaseState = providerInventory.find(({ provider }) => provider === "supabase");
    if (request.database === "keep" && inventory.database.providerHint === "supabase" &&
        databaseState?.state !== "identified") {
      blockers.push("DATABASE_PROVIDER_NOT_VERIFIED");
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
    const schedulerProviders = providerInventory.filter(({ provider }) =>
      ["netlify", "cloudflare", "vercel", "supabase"].includes(provider));
    const incompleteSchedulerTargets = schedulerProviders.some((provider) =>
      provider.state !== "identified" ||
      (provider.schedulerInventory?.state !== "verified" && provider.schedulerInventory?.state !== "not-installed") ||
      provider.schedulerInventory.completeness === "not-inspected" ||
      provider.schedulerInventory.completeness === "partial");
    if (incompleteSchedulerTargets) blockers.push("GLOBAL_SCHEDULER_INVENTORY_INCOMPLETE");
    const supabaseTriggers = providerInventory.find(({ provider }) => provider === "supabase")?.schedulerInventory?.triggers ?? [];
    if (supabaseTriggers.filter(({ active }) => active).length > 1) {
      blockers.push("DUPLICATE_SUPABASE_NOVA_CRON_TRIGGERS");
    }
    const cloudflareTriggers = providerInventory.find(({ provider }) => provider === "cloudflare")?.schedulerInventory?.triggers ?? [];
    if (cloudflareTriggers.filter(({ active }) => active).length > 1) {
      blockers.push("DUPLICATE_CLOUDFLARE_NOVA_CRON_TRIGGERS");
    }
    if (liveIdentity?.configuredScheduler === "supabase" &&
        providerInventory.find(({ provider }) => provider === "supabase")?.schedulerInventory?.state === "verified" &&
        !supabaseTriggers.some(({ active }) => active)) {
      blockers.push("CONFIGURED_SUPABASE_SCHEDULER_HAS_NO_ACTIVE_NOVA_JOB");
    }
    if (liveIdentity?.configuredScheduler === "cloudflare" &&
        providerInventory.find(({ provider }) => provider === "cloudflare")?.schedulerInventory?.state === "verified" &&
        !cloudflareTriggers.some(({ active }) => active)) {
      blockers.push("CONFIGURED_CLOUDFLARE_SCHEDULER_HAS_NO_ACTIVE_TRIGGER");
    }
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
      { id: "inventory-schedulers", resource: "scheduler", operation: "enumerate every trigger targeting this database", execution: "provider-inventory-required" },
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
      { id: "promote-origin", resource: "domain", operation: "promote the reviewed hostname after candidate verification", execution: "not-implemented" },
    );
  } else {
    actions.push({ id: "verify-runtime", resource: "runtime", operation: "confirm the existing " + request.runtime + " runtime remains healthy", execution: "provider-inventory-required" });
  }
  if (schedulerChanges) {
    actions.push({ id: "handover-scheduler", resource: "scheduler", operation: "hand over to " + request.scheduler, execution: "not-implemented" });
  } else {
    actions.push({ id: "verify-scheduler", resource: "scheduler", operation: "verify and retain the currently selected scheduler", execution: "provider-inventory-required" });
  }

  const identity = JSON.stringify({ request, source: inventory.source, localHints: {
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
    ...(providerInventory ? { providerInventory } : {}),
  };
}
