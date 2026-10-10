import type { LocalDeploymentInventory } from "./inventory.ts";
import type { ProviderResource } from "./providers.ts";
import type { StoredDeploymentPlan } from "./state.ts";

type BoundPlan = Pick<StoredDeploymentPlan, "preview">;

function providerSnapshot(resources: readonly ProviderResource[]): unknown[] {
  return resources.map((resource) => ({
    provider: resource.provider,
    state: resource.state,
    target: resource.target ?? null,
    revision: resource.revision ?? null,
    runtime: resource.runtime ?? null,
    runtimeId: resource.runtimeId ?? null,
    release: resource.release ?? null,
    origin: resource.origin ?? null,
    databaseVersion: resource.databaseVersion ?? null,
    databaseFingerprint: resource.databaseFingerprint ?? null,
    schemaReady: resource.schemaReady ?? null,
    migrationLedgerPresent: resource.migrationLedgerPresent ?? null,
    publicReadiness: resource.publicReadiness ?? null,
    configuredScheduler: resource.configuredScheduler ?? null,
    schedulerInventory: resource.schedulerInventory ? {
      scope: resource.schedulerInventory.scope,
      state: resource.schedulerInventory.state,
      completeness: resource.schedulerInventory.completeness,
      triggers: [...resource.schedulerInventory.triggers]
        .sort((left, right) => left.id.localeCompare(right.id)),
    } : null,
    migrationInventory: resource.migrationInventory ? {
      state: resource.migrationInventory.state,
      appliedCount: resource.migrationInventory.appliedCount,
      migrationHead: resource.migrationInventory.migrationHead,
      expectedHead: resource.migrationInventory.expectedHead,
      checksumsVerified: resource.migrationInventory.checksumsVerified,
    } : null,
    runtimeBindings: resource.runtimeBindings ? {
      state: resource.runtimeBindings.state,
      completeness: resource.runtimeBindings.completeness,
      bindings: [...resource.runtimeBindings.bindings]
        .map((binding) => ({
          name: binding.name,
          type: binding.type,
          resourceId: binding.resourceId ?? null,
          scopes: [...binding.scopes].sort(),
          contexts: [...binding.contexts].sort(),
          secret: binding.secret,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      hyperdrive: resource.runtimeBindings.hyperdrive ? {
        configurationId: resource.runtimeBindings.hyperdrive.configurationId,
        databaseTarget: resource.runtimeBindings.hyperdrive.databaseTarget,
        runtimeRole: resource.runtimeBindings.hyperdrive.runtimeRole,
      } : null,
      configuredScheduler: resource.runtimeBindings.configuredScheduler ?? null,
      buildSchedulerAvailable: resource.runtimeBindings.buildSchedulerAvailable ?? null,
      configuredBuildScheduler: resource.runtimeBindings.configuredBuildScheduler ?? null,
    } : null,
    candidateAccessProtection: resource.candidateAccessProtection ? {
      state: resource.candidateAccessProtection.state,
      previewUrlsEnabled: resource.candidateAccessProtection.previewUrlsEnabled,
      workerScopedPolicy: resource.candidateAccessProtection.workerScopedPolicy,
      publicDestinationOverrides: resource.candidateAccessProtection.publicDestinationOverrides,
    } : null,
    domainRoutes: resource.domainRoutes ? {
      state: resource.domainRoutes.state,
      completeness: resource.domainRoutes.completeness,
      domains: [...resource.domainRoutes.domains]
        .map(({ hostname, source, enabled }) => ({ hostname, source, enabled: enabled ?? null }))
        .sort((left, right) => left.hostname.localeCompare(right.hostname)),
      cloudflareRouting: resource.domainRoutes.cloudflareRouting ? {
        state: resource.domainRoutes.cloudflareRouting.state,
        completeness: resource.domainRoutes.cloudflareRouting.completeness,
        zones: [...resource.domainRoutes.cloudflareRouting.zones].map((zone) => ({
          zoneId: zone.zoneId,
          hostnames: [...zone.hostnames].sort(),
          state: zone.state,
          routes: [...zone.routes].sort((left, right) => left.pattern.localeCompare(right.pattern) || (left.script ?? "").localeCompare(right.script ?? "")),
          dnsRecords: [...zone.dnsRecords].sort((left, right) =>
            left.hostname.localeCompare(right.hostname) || left.type.localeCompare(right.type) || Number(left.proxied) - Number(right.proxied)),
        })).sort((left, right) => left.zoneId.localeCompare(right.zoneId)),
      } : null,
    } : null,
  })).sort((left, right) => String(left.provider).localeCompare(String(right.provider)));
}

export interface DeploymentPlanVerification {
  valid: boolean;
  scope: "local-only" | "local-and-remote";
  issues: string[];
}

/** Re-read the local snapshot and, when bound, the exact remote inventory before any future write. */
export function verifyDeploymentPlanSnapshot(
  plan: BoundPlan,
  local: LocalDeploymentInventory,
  remote?: readonly ProviderResource[],
): DeploymentPlanVerification {
  const issues: string[] = [];
  const expected = plan.preview;
  if (expected.source.commit !== local.source.commit) issues.push("SOURCE_COMMIT_CHANGED");
  if (expected.source.branch !== local.source.branch) issues.push("SOURCE_BRANCH_CHANGED");
  if (expected.source.clean !== local.source.clean) issues.push("SOURCE_WORKTREE_STATE_CHANGED");
  if (!local.source.clean) issues.push("SOURCE_WORKTREE_NOT_CLEAN");
  if (JSON.stringify(expected.localHints) !== JSON.stringify({
    runtimeHint: local.runtimeHint,
    database: local.database,
    schedulerHint: local.schedulerHint,
  })) issues.push("LOCAL_DEPLOYMENT_CONFIGURATION_CHANGED");

  const expectedRemote = expected.providerInventory;
  if (expectedRemote && !remote) issues.push("REMOTE_INVENTORY_RECHECK_REQUIRED");
  else if (!expectedRemote && remote) issues.push("REMOTE_INVENTORY_NOT_BOUND_TO_PLAN");
  else if (expectedRemote && remote &&
      JSON.stringify(providerSnapshot(expectedRemote)) !== JSON.stringify(providerSnapshot(remote))) {
    issues.push("REMOTE_INVENTORY_CHANGED");
  }
  return {
    valid: issues.length === 0,
    scope: expectedRemote ? "local-and-remote" : "local-only",
    issues,
  };
}
