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
  expect(first.actions.some(({ resource, execution }) => resource === "runtime" && execution === "not-implemented")).toBe(true);
  expect(JSON.stringify(first)).not.toMatch(/password|secret-value|token-value/i);
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
  expect(preview.blockers).not.toContain("DATABASE_PROVIDER_NOT_VERIFIED");
});
