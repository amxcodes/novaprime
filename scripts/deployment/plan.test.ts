import { expect, test } from "bun:test";
import { buildDeploymentPreview } from "./plan.ts";
import type { LocalDeploymentInventory } from "./inventory.ts";

const cloudflareBindings = [
  { name: "HYPERDRIVE", type: "hyperdrive", scopes: ["worker"], contexts: ["production"], secret: false },
  { name: "BETTER_AUTH_SECRET", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "BETTER_AUTH_URL", type: "plain_text", scopes: ["worker"], contexts: ["production"], secret: false },
  { name: "NOVA_BOOTSTRAP_TOKEN", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "NOVA_SECRETS_ENCRYPTION_KEY", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "NOVA_BACKGROUND_JOB_SECRET", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", scopes: ["worker"], contexts: ["production"], secret: false },
];

const inventory: LocalDeploymentInventory = {
  environmentSource: "test",
  source: { branch: "main", commit: "a".repeat(40), clean: true, dirtyPathCount: 0, packageVersion: "1.2.3" },
  runtimeHint: "netlify",
  database: {
    configured: true, providerHint: "supabase", projectRef: "abcdefghijklmnopqrst",
    endpointLabel: "Supabase project abcdefghijklmnopqrst", identityFingerprint: "b".repeat(64),
  },
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

test("a hosted runtime move keeps Supabase Cron and reconciles its stored callback before origin promotion", () => {
  const preview = buildDeploymentPreview(inventory, {
    runtime: "cloudflare",
    database: "keep",
    scheduler: "keep",
  });
  const actionIds = preview.actions.map(({ id }) => id);
  expect(actionIds.indexOf("deploy-candidate")).toBeLessThan(actionIds.indexOf("repoint-supabase-cron"));
  expect(actionIds.indexOf("repoint-supabase-cron")).toBeLessThan(actionIds.indexOf("promote-origin"));
  expect(preview.actions.find(({ id }) => id === "repoint-supabase-cron")).toMatchObject({
    execution: "not-implemented",
    resource: "scheduler",
  });
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
  expect(preview.blockers).toContain("DATABASE_MIGRATION_STATE_UNVERIFIED");
  expect(preview.blockers).not.toContain("DATABASE_PROVIDER_NOT_VERIFIED");
});

test("runtime move requires target production bindings, secret classification, and matching scheduler selector", () => {
  const providers = [
    {
      provider: "cloudflare" as const, state: "identified" as const, target: "account/worker", revision: "worker-revision",
      runtimeBindings: { state: "verified" as const, completeness: "selected-runtime" as const, bindings: cloudflareBindings, configuredScheduler: "supabase" },
      domainRoutes: { state: "verified" as const, completeness: "selected-runtime" as const, domains: [{ hostname: "nova.example.test", source: "custom-domain" as const }] },
      schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "resource-only" as const, triggers: [] },
    },
    {
      provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst",
      migrationInventory: { state: "current" as const, appliedCount: 4, migrationHead: "0004_schema.sql", expectedHead: "0004_schema.sql", checksumsVerified: true },
      schedulerInventory: { scope: "database-project" as const, state: "verified" as const, completeness: "project-scoped" as const, triggers: [{ id: "cron-1", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }] },
    },
    { provider: "netlify" as const, state: "identified" as const, target: "site-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "vercel" as const, state: "identified" as const, target: "project-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "nova" as const, state: "identified" as const, runtime: "netlify", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64) },
  ];
  const preview = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, providers);
  expect(preview.blockers).not.toContain("TARGET_RUNTIME_BINDING_INVENTORY_INCOMPLETE");
  expect(preview.blockers).not.toContain("TARGET_RUNTIME_SCHEDULER_CONFIGURATION_MISMATCH");

  const invalid = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, runtimeBindings: { state: "verified", completeness: "selected-runtime", bindings: cloudflareBindings.filter(({ name }) => name !== "HYPERDRIVE").map((binding) => binding.name === "BETTER_AUTH_SECRET" ? { ...binding, secret: false } : binding), configuredScheduler: "cloudflare" } },
    ...providers.slice(1),
  ]);
  expect(invalid.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:HYPERDRIVE");
  expect(invalid.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:BETTER_AUTH_SECRET");
  expect(invalid.blockers).toContain("TARGET_RUNTIME_SCHEDULER_CONFIGURATION_MISMATCH");

  const domainUnknown = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: { state: "unavailable", completeness: "partial", domains: [], detail: "ROUTE_INVENTORY_FORBIDDEN" } },
    ...providers.slice(1),
  ]);
  expect(domainUnknown.blockers).toContain("TARGET_RUNTIME_CUSTOM_DOMAIN_INVENTORY_INCOMPLETE");
});

test("Netlify target bindings must be Functions-scoped and available in production", () => {
  const names = [
    ["DATABASE_URL", true], ["BETTER_AUTH_SECRET", true], ["BETTER_AUTH_URL", false],
    ["NOVA_BOOTSTRAP_TOKEN", true], ["NOVA_SECRETS_ENCRYPTION_KEY", true],
    ["NOVA_BACKGROUND_JOB_SECRET", true], ["NOVA_BACKGROUND_SCHEDULER", false],
  ] as const;
  const bindings = names.map(([name, secret]) => ({
    name, type: "environment-variable", scopes: ["functions"], contexts: ["production"], secret,
  }));
  const baseProviders = [
    {
      provider: "netlify" as const, state: "identified" as const, target: "site-id", revision: "deploy-id",
      runtimeBindings: { state: "verified" as const, completeness: "selected-runtime" as const, bindings, configuredScheduler: "supabase" },
      domainRoutes: { state: "verified" as const, completeness: "selected-runtime" as const, domains: [{ hostname: "nova.example.test", source: "custom-domain" as const }] },
    },
    { provider: "nova" as const, state: "identified" as const, runtime: "cloudflare", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64) },
  ];
  const request = { runtime: "netlify" as const, database: "keep" as const, scheduler: "keep" as const };
  const source = { ...inventory, runtimeHint: "cloudflare" as const };
  const valid = buildDeploymentPreview(source, request, baseProviders);
  expect(valid.blockers).not.toContain("TARGET_RUNTIME_BINDING_INVENTORY_INCOMPLETE");
  expect(valid.blockers).not.toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:DATABASE_URL");

  const wrongScope = buildDeploymentPreview(source, request, [{
    ...baseProviders[0]!,
    runtimeBindings: { ...baseProviders[0]!.runtimeBindings!, bindings: bindings.map((binding) =>
      binding.name === "DATABASE_URL" ? { ...binding, scopes: ["builds"] } : binding) },
  }, baseProviders[1]!]);
  expect(wrongScope.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:DATABASE_URL");

  const wrongContext = buildDeploymentPreview(source, request, [{
    ...baseProviders[0]!,
    runtimeBindings: { ...baseProviders[0]!.runtimeBindings!, bindings: bindings.map((binding) =>
      binding.name === "DATABASE_URL" ? { ...binding, contexts: ["deploy-preview"] } : binding) },
  }, baseProviders[1]!]);
  expect(wrongContext.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:DATABASE_URL");
});

test("remote plans block a Supabase project or database endpoint that differs from the live deployment", () => {
  const providers = [
    { provider: "netlify" as const, state: "identified" as const, target: "site-1", revision: "deploy-1" },
    { provider: "cloudflare" as const, state: "identified" as const, target: "acct/worker", revision: "etag-1" },
    { provider: "vercel" as const, state: "identified" as const, target: "project-1", revision: "dpl-1" },
    { provider: "supabase" as const, state: "identified" as const, target: "zyxwvutsrqponmlkjihg", runtime: "postgresql" },
    {
      provider: "nova" as const, state: "identified" as const, runtime: "netlify",
      configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64),
    },
  ];
  const selectedForWrongProject = buildDeploymentPreview(inventory, {
    runtime: "netlify", database: "keep", scheduler: "keep",
  }, providers);
  expect(selectedForWrongProject.blockers).toContain("DATABASE_PROJECT_IDENTITY_MISMATCH");

  const selectedForWrongEndpoint = buildDeploymentPreview({
    ...inventory,
    database: { ...inventory.database, identityFingerprint: "c".repeat(64) },
  }, {
    runtime: "netlify", database: "keep", scheduler: "keep",
  }, providers.map((provider) => provider.provider === "supabase"
    ? { ...provider, target: inventory.database.projectRef! }
    : provider));
  expect(selectedForWrongEndpoint.blockers).toContain("LIVE_DATABASE_IDENTITY_MISMATCH");
});

test("remote planning requires a stable provider revision for the selected runtime", () => {
  const providers = [
    { provider: "netlify" as const, state: "identified" as const, target: "site-1" },
    { provider: "cloudflare" as const, state: "identified" as const, target: "account/worker", revision: "etag-1" },
    { provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst" },
    {
      provider: "nova" as const, state: "identified" as const, runtime: "netlify",
      configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64),
    },
  ];
  const preview = buildDeploymentPreview(inventory, {
    runtime: "netlify", database: "keep", scheduler: "supabase",
  }, providers);
  expect(preview.blockers).toContain("TARGET_RUNTIME_REVISION_UNAVAILABLE");
});

test("remote plans stop on pending or diverged database migrations before a runtime change", () => {
  const providers = [
    { provider: "netlify" as const, state: "identified" as const, target: "site-1" },
    { provider: "cloudflare" as const, state: "identified" as const, target: "account/worker" },
    {
      provider: "supabase" as const,
      state: "identified" as const,
      target: "abcdefghijklmnopqrst",
      migrationInventory: {
        state: "behind" as const,
        appliedCount: 76,
        migrationHead: "0076_operator_update_checksums.sql",
        expectedHead: "0079_permission_customer_role_assignability.sql",
        checksumsVerified: true,
      },
    },
    {
      provider: "nova" as const, state: "identified" as const, runtime: "netlify",
      configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64),
    },
  ];
  const behind = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, providers);
  expect(behind.blockers).toContain("DATABASE_MIGRATIONS_REQUIRED_BEFORE_RUNTIME_CHANGE");

  const diverged = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, providers.map((provider) => provider.provider === "supabase"
    ? { ...provider, migrationInventory: { ...provider.migrationInventory, state: "diverged" as const } }
    : provider));
  expect(diverged.blockers).toContain("DATABASE_MIGRATION_HISTORY_DIVERGED");
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
    {
      provider: "nova" as const, state: "identified" as const, runtime: "netlify",
      configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64),
    },
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

test("a single-resource Cron read cannot close the global scheduler inventory gate", () => {
  const providers = [
    { provider: "netlify" as const, state: "identified" as const, schedulerInventory: {
      scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [],
    } },
    { provider: "cloudflare" as const, state: "identified" as const, schedulerInventory: {
      scope: "target-runtime" as const, state: "verified" as const, completeness: "resource-only" as const,
      triggers: [{ id: "nova-worker/schedule-1", name: "cloudflare-cron-trigger", schedule: "*/5 * * * *", active: true }],
    } },
    { provider: "vercel" as const, state: "identified" as const, schedulerInventory: {
      scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [],
    } },
    { provider: "supabase" as const, state: "identified" as const, schedulerInventory: {
      scope: "database-project" as const, state: "verified" as const, completeness: "project-scoped" as const,
      triggers: [{ id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }],
    }, migrationInventory: {
      state: "current" as const, appliedCount: 2, migrationHead: "0002_authentication_bootstrap.sql",
      expectedHead: "0002_authentication_bootstrap.sql", checksumsVerified: true,
    } },
    {
      provider: "nova" as const, state: "identified" as const, runtime: "netlify",
      configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64),
    },
  ];
  const preview = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, providers);
  expect(preview.blockers).toContain("GLOBAL_SCHEDULER_INVENTORY_INCOMPLETE");
});
