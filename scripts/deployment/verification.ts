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
    release: resource.release ?? null,
    origin: resource.origin ?? null,
    databaseVersion: resource.databaseVersion ?? null,
    databaseFingerprint: resource.databaseFingerprint ?? null,
    schemaReady: resource.schemaReady ?? null,
    migrationLedgerPresent: resource.migrationLedgerPresent ?? null,
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
