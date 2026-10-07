import { expect, test } from "bun:test";
import { buildDeploymentPreview } from "./plan.ts";
import type { LocalDeploymentInventory } from "./inventory.ts";

const inventory: LocalDeploymentInventory = {
  environmentSource: "test",
  source: { branch: "main", commit: "a".repeat(40), clean: true, dirtyPathCount: 0, packageVersion: "1.2.3" },
  runtimeHint: "netlify",
  database: { configured: true, providerHint: "supabase", projectRef: "abcdefghijklmnopqrst", endpointLabel: "Supabase project abcdefghijklmnopqrst" },
  schedulerHint: "supabase",
  secretPresence: {},
  providerCredentialPresence: {},
};

test("a preview is deterministic, secret-free and never claims apply is enabled", () => {
  const first = buildDeploymentPreview(inventory, {
    runtime: "cloudflare",
    database: "keep",
    scheduler: "supabase",
  });
  const second = buildDeploymentPreview(inventory, {
    runtime: "cloudflare",
    database: "keep",
    scheduler: "supabase",
  });
  expect(first.previewId).toBe(second.previewId);
  expect(first.persisted).toBe(false);
  expect(first.applyEnabled).toBe(false);
  expect(first.blockers).toContain("GLOBAL_SCHEDULER_INVENTORY_NOT_REQUESTED");
  expect(first.actions.some(({ resource, execution }) => resource === "runtime" && execution === "not-implemented")).toBe(true);
  expect(JSON.stringify(first)).not.toMatch(/password|secret-value|token-value/i);
});

test("an unchanged topology does not propose a runtime deploy, scheduler handover, or origin promotion", () => {
  const preview = buildDeploymentPreview({ ...inventory, runtimeHint: "netlify" }, {
    runtime: "netlify",
    database: "keep",
    scheduler: "keep",
  });
  const actionIds = preview.actions.map(({ id }) => id);
  expect(actionIds).toContain("verify-runtime");
  expect(actionIds).toContain("verify-scheduler");
  expect(actionIds).not.toContain("deploy-candidate");
  expect(actionIds).not.toContain("handover-scheduler");
  expect(actionIds).not.toContain("promote-origin");
});

test("unknown global scheduler inventory blocks a proposed move", () => {
  const preview = buildDeploymentPreview({ ...inventory, schedulerHint: null }, {
    runtime: "cloudflare",
    database: "keep",
    scheduler: "keep",
  });
  expect(preview.blockers).toContain("CURRENT_SCHEDULER_NOT_IDENTIFIED");
  expect(preview.applyEnabled).toBe(false);
});

test("database copy and project creation show explicit blockers", () => {
  const moved = buildDeploymentPreview(inventory, {
    runtime: "cloudflare",
    database: "move",
    scheduler: "supabase",
  });
  expect(moved.blockers).toContain("DATABASE_MOVE_REQUIRES_MAINTENANCE_GATE_AND_REHEARSAL");

  const provisioned = buildDeploymentPreview(inventory, {
    runtime: "netlify",
    database: "provision-supabase",
    scheduler: "supabase",
  });
  expect(provisioned.blockers).toContain("SUPABASE_PROJECT_PROVISIONING_NOT_IMPLEMENTED");
});

test("remote planning binds provider inventory and blocks an unverified runtime target", () => {
  const providers = [
    { provider: "netlify" as const, state: "identified" as const, target: "site-1", runtime: "netlify" },
    { provider: "cloudflare" as const, state: "unavailable" as const, target: "acct/worker", detail: "MISSING_READ_PERMISSION" },
    { provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst", runtime: "postgresql" },
  ];
  const preview = buildDeploymentPreview(inventory, {
    runtime: "cloudflare",
    database: "keep",
    scheduler: "supabase",
  }, providers);
  expect(preview.providerInventory).toEqual(providers);
  expect(preview.blockers).toContain("TARGET_RUNTIME_NOT_VERIFIED");
  expect(preview.blockers).toContain("GLOBAL_SCHEDULER_INVENTORY_INCOMPLETE");
  expect(preview.blockers).not.toContain("DATABASE_PROVIDER_NOT_VERIFIED");
});

test("remote plan detects duplicate or missing active NOVA schedulers", () => {
  const baseProviders = [
    {
      provider: "cloudflare" as const,
      state: "identified" as const,
      target: "account/worker",
      schedulerInventory: {
        scope: "target-runtime" as const,
        state: "verified" as const,
        completeness: "resource-only" as const,
        triggers: [],
      },
    },
    {
      provider: "supabase" as const,
      state: "identified" as const,
      target: "abcdefghijklmnopqrst",
      schedulerInventory: {
        scope: "database-project" as const,
        state: "verified" as const,
        completeness: "project-scoped" as const,
        triggers: [
          { id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true },
          { id: "13", name: "custom-nova-tick", schedule: "*/2 * * * *", active: true },
        ],
      },
    },
    { provider: "netlify" as const, state: "identified" as const, target: "site-id" },
    { provider: "vercel" as const, state: "identified" as const, target: "project-id" },
    { provider: "nova" as const, state: "identified" as const, runtime: "netlify", configuredScheduler: "supabase" },
  ];
  const duplicate = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, baseProviders);
  expect(duplicate.blockers).toContain("DUPLICATE_SUPABASE_NOVA_CRON_TRIGGERS");

  const missing = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, baseProviders.map((provider) => provider.provider === "supabase"
    ? { ...provider, schedulerInventory: { ...provider.schedulerInventory, triggers: [] } }
    : provider));
  expect(missing.blockers).toContain("CONFIGURED_SUPABASE_SCHEDULER_HAS_NO_ACTIVE_NOVA_JOB");
});
