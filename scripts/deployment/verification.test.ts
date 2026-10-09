import { expect, test } from "bun:test";
import type { LocalDeploymentInventory } from "./inventory.ts";
import type { DeploymentPreview } from "./plan.ts";
import type { ProviderResource } from "./providers.ts";
import type { StoredDeploymentPlan } from "./state.ts";
import { verifyDeploymentPlanSnapshot } from "./verification.ts";

const local: LocalDeploymentInventory = {
  environmentSource: "test",
  source: { branch: "main", commit: "a".repeat(40), clean: true, dirtyPathCount: 0, packageVersion: "1.2.3" },
  runtimeHint: "netlify",
  database: { configured: true, providerHint: "supabase", projectRef: "abcdefghijklmnopqrst", endpointLabel: "Supabase project abcdefghijklmnopqrst" },
  schedulerHint: "supabase",
  secretPresence: {},
  providerCredentialPresence: {},
};

const remote: ProviderResource[] = [{
  provider: "netlify",
  state: "identified",
  target: "site-1",
  runtime: "netlify",
  release: "a".repeat(40),
  schedulerInventory: {
    scope: "target-runtime",
    state: "verified",
    completeness: "project-scoped",
    triggers: [{ id: "nova-background-tick", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }],
  },
  runtimeBindings: {
    state: "verified",
    completeness: "selected-runtime",
    bindings: [{ name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", scopes: ["worker"], contexts: ["production"], secret: false }],
    configuredScheduler: "supabase",
    buildSchedulerAvailable: true,
    configuredBuildScheduler: "supabase",
  },
  domainRoutes: {
    state: "verified",
    completeness: "selected-runtime",
    domains: [{ hostname: "nova.example.test", source: "custom-domain" }],
  },
}];

const plan = {
  preview: {
    source: { branch: "main", commit: "a".repeat(40), clean: true },
    localHints: {
      runtimeHint: "netlify",
      database: local.database,
      schedulerHint: "supabase",
    },
    providerInventory: remote,
  } as DeploymentPreview,
} as StoredDeploymentPlan;

test("plan verification accepts a matching local and provider snapshot", () => {
  expect(verifyDeploymentPlanSnapshot(plan, local, remote)).toEqual({
    valid: true,
    scope: "local-and-remote",
    issues: [],
  });
});

test("plan verification ignores descriptive provider detail but detects changed schedules", () => {
  const current = [{
    ...remote[0]!,
    detail: "deployment timestamp changed",
    schedulerInventory: {
      ...remote[0]!.schedulerInventory!,
      triggers: [{ ...remote[0]!.schedulerInventory!.triggers[0]!, schedule: "*/2 * * * *" }],
    },
  }];
  expect(verifyDeploymentPlanSnapshot(plan, local, current).issues).toEqual(["REMOTE_INVENTORY_CHANGED"]);
});

test("plan verification detects a new provider deployment revision", () => {
  expect(verifyDeploymentPlanSnapshot(plan, local, [{ ...remote[0]!, revision: "deploy-2" }]).issues)
    .toEqual(["REMOTE_INVENTORY_CHANGED"]);
});

test("plan verification detects a changed immutable runtime version id", () => {
  const boundPlan = { preview: { ...plan.preview, providerInventory: [{ ...remote[0]!, runtimeId: "version-1" }] } } as StoredDeploymentPlan;
  expect(verifyDeploymentPlanSnapshot(boundPlan, local, [{ ...remote[0]!, runtimeId: "version-2" }]).issues)
    .toEqual(["REMOTE_INVENTORY_CHANGED"]);
});

test("plan verification detects runtime binding and custom-domain changes", () => {
  const changed = [{
    ...remote[0]!,
    runtimeBindings: { ...remote[0]!.runtimeBindings!, configuredScheduler: "cloudflare" },
    domainRoutes: { ...remote[0]!.domainRoutes!, domains: [{ hostname: "other.example.test", source: "custom-domain" as const }] },
  }];
  expect(verifyDeploymentPlanSnapshot(plan, local, changed).issues).toEqual(["REMOTE_INVENTORY_CHANGED"]);
});

test("plan verification detects changed Netlify build-time scheduler selection", () => {
  const changed = [{
    ...remote[0]!,
    runtimeBindings: { ...remote[0]!.runtimeBindings!, configuredBuildScheduler: "netlify" },
  }];
  expect(verifyDeploymentPlanSnapshot(plan, local, changed).issues).toEqual(["REMOTE_INVENTORY_CHANGED"]);
});

test("plan verification detects changed Cloudflare route or exact-host DNS evidence", () => {
  const cloudflare: ProviderResource = {
    ...remote[0]!,
    provider: "cloudflare",
    target: "account/worker",
    domainRoutes: {
      state: "verified",
      completeness: "selected-runtime",
      domains: [{ hostname: "nova.example.test", source: "custom-domain" }],
      cloudflareRouting: {
        state: "verified",
        completeness: "selected-runtime",
        zones: [{
          zoneId: "c".repeat(32),
          hostnames: ["nova.example.test"],
          state: "verified",
          routes: [{ pattern: "other.example.test/*", script: "other-worker" }],
          dnsRecords: [{ hostname: "nova.example.test", type: "A", proxied: true }],
        }],
      },
    },
  };
  const cloudflarePlan = { preview: { ...plan.preview, providerInventory: [cloudflare] } } as StoredDeploymentPlan;
  const changed = [{
    ...cloudflare,
    domainRoutes: {
      ...cloudflare.domainRoutes!,
      cloudflareRouting: {
        ...cloudflare.domainRoutes!.cloudflareRouting!,
        zones: [{
          ...cloudflare.domainRoutes!.cloudflareRouting!.zones[0]!,
          routes: [{ pattern: "nova.example.test/*", script: "unexpected-worker" }],
        }],
      },
    },
  }];
  expect(verifyDeploymentPlanSnapshot(cloudflarePlan, local, changed).issues).toEqual(["REMOTE_INVENTORY_CHANGED"]);
});

test("remote-bound plans require a fresh remote read and clean exact source", () => {
  const dirty = { ...local, source: { ...local.source, clean: false, dirtyPathCount: 1 } };
  expect(verifyDeploymentPlanSnapshot(plan, dirty).issues).toEqual([
    "SOURCE_WORKTREE_STATE_CHANGED",
    "SOURCE_WORKTREE_NOT_CLEAN",
    "REMOTE_INVENTORY_RECHECK_REQUIRED",
  ]);
});
