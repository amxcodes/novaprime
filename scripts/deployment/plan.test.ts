import { expect, test } from "bun:test";
import { buildDeploymentPreview } from "./plan.ts";
import type { LocalDeploymentInventory } from "./inventory.ts";

const cloudflareBindings = [
  { name: "HYPERDRIVE", type: "hyperdrive", resourceId: "hyperdrive-id", scopes: ["worker"], contexts: ["production"], secret: false },
  { name: "CF_VERSION_METADATA", type: "version_metadata", scopes: ["worker"], contexts: ["production"], secret: false },
  { name: "BETTER_AUTH_SECRET", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "BETTER_AUTH_URL", type: "plain_text", scopes: ["worker"], contexts: ["production"], secret: false },
  { name: "NOVA_BOOTSTRAP_TOKEN", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "NOVA_SECRETS_ENCRYPTION_KEY", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "NOVA_BACKGROUND_JOB_SECRET", type: "secret_text", scopes: ["worker"], contexts: ["production"], secret: true },
  { name: "NOVA_BACKGROUND_SCHEDULER", type: "plain_text", scopes: ["worker"], contexts: ["production"], secret: false },
];
const cloudflareDomainRoutes = {
  state: "verified" as const,
  completeness: "selected-runtime" as const,
  domains: [{ hostname: "nova.example.test", source: "custom-domain" as const, enabled: true }],
  cloudflareRouting: {
    state: "verified" as const,
    completeness: "selected-runtime" as const,
    zones: [{
      zoneId: "c".repeat(32),
      hostnames: ["nova.example.test"],
      state: "verified" as const,
      routes: [] as Array<{ pattern: string; script: string | null }>,
      dnsRecords: [{ hostname: "nova.example.test", type: "A", proxied: true }],
    }],
  },
};

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
  expect(first.previewId).not.toBe(buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, undefined, true).previewId);
  expect(first.persisted).toBe(false);
  expect(first.applyEnabled).toBe(false);
  expect(first.blockers).toContain("GLOBAL_SCHEDULER_INVENTORY_NOT_REQUESTED");
  expect(first.actions.find(({ id }) => id === "inventory-schedulers")?.operation)
    .toContain("identify every runtime/scheduler resource");
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
  expect(preview.blockers).toContain("SCHEDULER_SCOPE_CONFIRMATION_REQUIRED");
  expect(preview.blockers).toContain("SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:cloudflare");
  expect(preview.blockers).toContain("SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:supabase");
  expect(preview.blockers).toContain("DATABASE_MIGRATION_STATE_UNVERIFIED");
  expect(preview.blockers).not.toContain("DATABASE_PROVIDER_NOT_VERIFIED");
});

test("runtime move requires target production bindings, secret classification, and matching scheduler selector", () => {
  const providers = [
    {
      provider: "cloudflare" as const, state: "identified" as const, target: "account/worker", revision: "worker-revision",
      runtimeBindings: { state: "verified" as const, completeness: "selected-runtime" as const, bindings: cloudflareBindings, hyperdrive: { configurationId: "hyperdrive-id", databaseTarget: "verified" as const, runtimeRole: "verified" as const }, configuredScheduler: "supabase" },
      domainRoutes: cloudflareDomainRoutes,
      schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "resource-only" as const, triggers: [] },
    },
    {
      provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst",
      migrationInventory: { state: "current" as const, appliedCount: 4, migrationHead: "0004_schema.sql", expectedHead: "0004_schema.sql", checksumsVerified: true },
      schedulerInventory: { scope: "database-project" as const, state: "verified" as const, completeness: "project-scoped" as const, triggers: [{ id: "cron-1", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }] },
    },
    { provider: "netlify" as const, state: "identified" as const, target: "site-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "vercel" as const, state: "identified" as const, target: "project-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "nova" as const, state: "identified" as const, runtime: "netlify", origin: "https://nova.example.test", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64) },
  ];
  const preview = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, providers, true);
  expect(preview.blockers).not.toContain("TARGET_RUNTIME_BINDING_INVENTORY_INCOMPLETE");
  expect(preview.blockers).not.toContain("TARGET_RUNTIME_SCHEDULER_CONFIGURATION_MISMATCH");
  expect(preview.blockers).not.toContain("CURRENT_PUBLIC_HOSTNAME_UNVERIFIED");
  expect(preview.blockers).not.toContain("TARGET_RUNTIME_PUBLIC_HOSTNAME_NOT_ATTACHED");
  expect(preview.blockers).not.toContain("TARGET_CLOUDFLARE_ROUTE_DNS_INVENTORY_INCOMPLETE");
  expect(preview.blockers).not.toContain("TARGET_CLOUDFLARE_DNS_RECORD_NOT_VISIBLE");
  expect(preview.blockers).not.toContain("TARGET_CLOUDFLARE_ROUTE_SHADOWS_PUBLIC_HOSTNAME");

  for (const scheduler of ["keep", "supabase"] as const) {
    const liveIdentityOnly = buildDeploymentPreview({ ...inventory, runtimeHint: null, schedulerHint: null }, {
      runtime: "cloudflare", database: "keep", scheduler,
    }, providers, true);
    expect(liveIdentityOnly.blockers).not.toContain("CURRENT_RUNTIME_NOT_IDENTIFIED");
    expect(liveIdentityOnly.blockers).not.toContain("CURRENT_SCHEDULER_NOT_IDENTIFIED");
    expect(liveIdentityOnly.blockers).not.toContain("CROSS_PROVIDER_SCHEDULER_INVENTORY_NOT_IMPLEMENTED");
  }

  const invalid = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, runtimeBindings: { state: "verified", completeness: "selected-runtime", bindings: cloudflareBindings.filter(({ name }) => name !== "HYPERDRIVE" && name !== "CF_VERSION_METADATA").map((binding) => binding.name === "BETTER_AUTH_SECRET" ? { ...binding, secret: false } : binding), configuredScheduler: "cloudflare" } },
    ...providers.slice(1),
  ], true);
  expect(invalid.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:HYPERDRIVE");
  expect(invalid.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:CF_VERSION_METADATA");
  expect(invalid.blockers).toContain("TARGET_RUNTIME_REQUIRED_BINDING_INVALID:BETTER_AUTH_SECRET");
  expect(invalid.blockers).toContain("TARGET_RUNTIME_SCHEDULER_CONFIGURATION_MISMATCH");

  const domainUnknown = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: { state: "unavailable", completeness: "partial", domains: [], detail: "ROUTE_INVENTORY_FORBIDDEN" } },
    ...providers.slice(1),
  ], true);
  expect(domainUnknown.blockers).toContain("TARGET_RUNTIME_CUSTOM_DOMAIN_INVENTORY_INCOMPLETE");

  const targetHostnameMissing = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: { state: "verified", completeness: "selected-runtime", domains: [] } },
    ...providers.slice(1),
  ], true);
  expect(targetHostnameMissing.blockers).toContain("TARGET_RUNTIME_PUBLIC_HOSTNAME_NOT_ATTACHED");

  const targetHostnameDisabled = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: { ...cloudflareDomainRoutes, domains: [{ hostname: "nova.example.test", source: "custom-domain", enabled: false }] } },
    ...providers.slice(1),
  ], true);
  expect(targetHostnameDisabled.blockers).toContain("TARGET_CLOUDFLARE_PUBLIC_HOSTNAME_DISABLED");
  const targetHostnameStatusUnknown = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: { ...cloudflareDomainRoutes, domains: [{ hostname: "nova.example.test", source: "custom-domain" }] } },
    ...providers.slice(1),
  ], true);
  expect(targetHostnameStatusUnknown.blockers).toContain("TARGET_CLOUDFLARE_DOMAIN_ROUTABILITY_UNVERIFIED");

  const shadowedRoute = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: {
      ...cloudflareDomainRoutes,
      cloudflareRouting: { ...cloudflareDomainRoutes.cloudflareRouting, zones: [{
        ...cloudflareDomainRoutes.cloudflareRouting.zones[0]!,
        routes: [{ pattern: "*.example.test/*", script: "other-worker" }],
      }] },
    } },
    ...providers.slice(1),
  ], true);
  expect(shadowedRoute.blockers).toContain("TARGET_CLOUDFLARE_ROUTE_SHADOWS_PUBLIC_HOSTNAME");

  const dnsMissing = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    { ...providers[0]!, domainRoutes: {
      ...cloudflareDomainRoutes,
      cloudflareRouting: { ...cloudflareDomainRoutes.cloudflareRouting, zones: [{
        ...cloudflareDomainRoutes.cloudflareRouting.zones[0]!, dnsRecords: [],
      }] },
    } },
    ...providers.slice(1),
  ], true);
  expect(dnsMissing.blockers).toContain("TARGET_CLOUDFLARE_DNS_RECORD_NOT_VISIBLE");

  const currentHostnameUnknown = buildDeploymentPreview(inventory, { runtime: "cloudflare", database: "keep", scheduler: "keep" }, [
    ...providers.slice(0, -1),
    { ...providers.at(-1)!, origin: undefined },
  ], true);
  expect(currentHostnameUnknown.blockers).toContain("CURRENT_PUBLIC_HOSTNAME_UNVERIFIED");
});

test("Cloudflare runtime moves verify the Hyperdrive project and restricted app role", () => {
  const providers = [
    {
      provider: "cloudflare" as const, state: "identified" as const, target: "account/worker", revision: "worker-revision",
      runtimeBindings: {
        state: "verified" as const, completeness: "selected-runtime" as const,
        bindings: cloudflareBindings,
        hyperdrive: { configurationId: "hyperdrive-id", databaseTarget: "verified" as const, runtimeRole: "verified" as const },
        configuredScheduler: "supabase",
      },
      domainRoutes: cloudflareDomainRoutes,
      schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "resource-only" as const, triggers: [] },
    },
    { provider: "netlify" as const, state: "identified" as const, target: "site-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst", migrationInventory: { state: "current" as const, appliedCount: 4, migrationHead: "0004_schema.sql", expectedHead: "0004_schema.sql", checksumsVerified: true }, schedulerInventory: { scope: "database-project" as const, state: "verified" as const, completeness: "project-scoped" as const, triggers: [{ id: "cron-1", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }] } },
    { provider: "nova" as const, state: "identified" as const, runtime: "netlify", origin: "https://nova.example.test", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64), publicReadiness: "ready" as const },
  ];
  const request = { runtime: "cloudflare" as const, database: "keep" as const, scheduler: "keep" as const };
  const valid = buildDeploymentPreview(inventory, request, providers, true);
  expect(valid.blockers).not.toContain("TARGET_CLOUDFLARE_HYPERDRIVE_DATABASE_UNVERIFIED");
  expect(valid.blockers).not.toContain("TARGET_CLOUDFLARE_HYPERDRIVE_RUNTIME_ROLE_UNVERIFIED");

  const mismatch = buildDeploymentPreview(inventory, request, [
    { ...providers[0]!, runtimeBindings: { ...providers[0]!.runtimeBindings, hyperdrive: { configurationId: "hyperdrive-id", databaseTarget: "mismatch" as const, runtimeRole: "invalid" as const } } },
    ...providers.slice(1),
  ], true);
  expect(mismatch.blockers).toContain("TARGET_CLOUDFLARE_HYPERDRIVE_DATABASE_MISMATCH");
  expect(mismatch.blockers).toContain("TARGET_CLOUDFLARE_HYPERDRIVE_RUNTIME_ROLE_INVALID");

  const unknown = buildDeploymentPreview(inventory, request, [
    { ...providers[0]!, runtimeBindings: { ...providers[0]!.runtimeBindings, hyperdrive: undefined } },
    ...providers.slice(1),
  ], true);
  expect(unknown.blockers).toContain("TARGET_CLOUDFLARE_HYPERDRIVE_DATABASE_UNVERIFIED");
  expect(unknown.blockers).toContain("TARGET_CLOUDFLARE_HYPERDRIVE_RUNTIME_ROLE_UNVERIFIED");
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
      runtimeBindings: { state: "verified" as const, completeness: "selected-runtime" as const, bindings, configuredScheduler: "supabase", buildSchedulerAvailable: true, configuredBuildScheduler: "supabase" },
      domainRoutes: { state: "verified" as const, completeness: "selected-runtime" as const, domains: [{ hostname: "nova.example.test", source: "custom-domain" as const, enabled: true }] },
    },
    { provider: "nova" as const, state: "identified" as const, runtime: "cloudflare", origin: "https://nova.example.test", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64) },
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

  const missingBuildSelector = buildDeploymentPreview(source, request, [{
    ...baseProviders[0]!,
    runtimeBindings: { ...baseProviders[0]!.runtimeBindings!, buildSchedulerAvailable: false, configuredBuildScheduler: undefined },
  }, baseProviders[1]!]);
  expect(missingBuildSelector.blockers).toContain("TARGET_NETLIFY_BUILD_SCHEDULER_CONFIGURATION_MISMATCH");
});

test("Netlify Cron to Supabase Cron is a staged scheduler-only plan with exact source and empty target", () => {
  const sourceInventory = { ...inventory, runtimeHint: "netlify" as const, schedulerHint: "netlify" as const };
  const netlifyBindings = [
    ["DATABASE_URL", true], ["BETTER_AUTH_SECRET", true], ["BETTER_AUTH_URL", false],
    ["NOVA_BOOTSTRAP_TOKEN", true], ["NOVA_SECRETS_ENCRYPTION_KEY", true],
    ["NOVA_BACKGROUND_JOB_SECRET", true], ["NOVA_BACKGROUND_SCHEDULER", false],
  ] as const;
  const providers = [
    {
      provider: "netlify" as const, state: "identified" as const, target: "site-id", revision: "deploy-id",
      schedulerInventory: { scope: "target-runtime" as const, state: "verified" as const, completeness: "project-scoped" as const,
        triggers: [{ id: "nova-background-tick", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }] },
      runtimeBindings: {
        state: "verified" as const, completeness: "selected-runtime" as const,
        bindings: netlifyBindings.map(([name, secret]) => ({ name, type: "environment-variable", scopes: ["functions"], contexts: ["production"], secret })),
        configuredScheduler: "netlify", buildSchedulerAvailable: true, configuredBuildScheduler: "netlify",
      },
    },
    { provider: "supabase" as const, state: "identified" as const, target: sourceInventory.database.projectRef!,
      schedulerInventory: { scope: "database-project" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "nova" as const, state: "identified" as const, target: "https://nova.example.test", runtime: "netlify", configuredScheduler: "netlify", databaseFingerprint: sourceInventory.database.identityFingerprint!, schemaReady: true, migrationLedgerPresent: true, publicReadiness: "ready" as const },
  ];
  const preview = buildDeploymentPreview(sourceInventory, { runtime: "netlify", database: "keep", scheduler: "supabase" }, providers, true);
  const actionIds = preview.actions.map(({ id }) => id);
  expect(preview.blockers).not.toContain("CROSS_PROVIDER_SCHEDULER_INVENTORY_NOT_IMPLEMENTED");
  expect(preview.blockers).not.toContain("NETLIFY_SOURCE_CRON_NOT_EXACTLY_ONE_NOVA_TICK");
  expect(preview.blockers).toHaveLength(0);
  expect(preview.applyEnabled).toBe(false);
  expect(actionIds.indexOf("deploy-netlify-api-only")).toBeLessThan(actionIds.indexOf("create-supabase-cron"));
  expect(actionIds.indexOf("create-supabase-cron")).toBeLessThan(actionIds.indexOf("verify-supabase-cron"));
  expect(preview.actions.filter(({ id }) => id.startsWith("deploy-netlify") || id.includes("supabase-cron")))
    .toHaveLength(3);

  const unexpectedNetlifySchedule = buildDeploymentPreview(sourceInventory, { runtime: "netlify", database: "keep", scheduler: "supabase" }, [
    { ...providers[0]!, schedulerInventory: { ...providers[0]!.schedulerInventory!, triggers: [
      { id: "other-job", name: "other-job", schedule: "*/5 * * * *", active: true },
    ] } }, ...providers.slice(1),
  ], true);
  expect(unexpectedNetlifySchedule.blockers).toContain("NETLIFY_SOURCE_CRON_NOT_EXACTLY_ONE_NOVA_TICK");

  const activeSupabase = buildDeploymentPreview(sourceInventory, { runtime: "netlify", database: "keep", scheduler: "supabase" }, [
    providers[0]!,
    { ...providers[1]!, schedulerInventory: { ...providers[1]!.schedulerInventory!, state: "verified", triggers: [
      { id: "12", name: "nova-background-tick", schedule: "*/5 * * * *", active: true },
    ] } }, providers[2]!,
  ], true);
  expect(activeSupabase.blockers).toContain("SUPABASE_CRON_TARGET_NOT_EMPTY_OR_UNVERIFIED");

  const wrongBuildSelector = buildDeploymentPreview(sourceInventory, { runtime: "netlify", database: "keep", scheduler: "supabase" }, [
    { ...providers[0]!, runtimeBindings: { ...providers[0]!.runtimeBindings!, configuredBuildScheduler: "supabase" } }, ...providers.slice(1),
  ], true);
  expect(wrongBuildSelector.blockers).toContain("NETLIFY_BUILD_SCHEDULER_SELECTOR_MISMATCH");

  const secretFunctionSelector = buildDeploymentPreview(sourceInventory, { runtime: "netlify", database: "keep", scheduler: "supabase" }, [
    { ...providers[0]!, runtimeBindings: { ...providers[0]!.runtimeBindings!, bindings: providers[0]!.runtimeBindings!.bindings.map((binding) =>
      binding.name === "NOVA_BACKGROUND_SCHEDULER" ? { ...binding, secret: true } : binding) } }, ...providers.slice(1),
  ], true);
  expect(secretFunctionSelector.blockers).toContain("NETLIFY_FUNCTION_SCHEDULER_SELECTOR_MISMATCH");

  const secondKnownCron = buildDeploymentPreview(sourceInventory, { runtime: "netlify", database: "keep", scheduler: "supabase" }, [
    ...providers,
    { provider: "cloudflare" as const, state: "identified" as const, schedulerInventory: {
      scope: "target-runtime" as const, state: "verified" as const, completeness: "resource-only" as const,
      triggers: [{ id: "worker/schedule-1", name: "cloudflare-cron-trigger", schedule: "*/5 * * * *", active: true }],
    } },
  ], true);
  expect(secondKnownCron.blockers).toContain("UNSELECTED_SCHEDULER_TRIGGER_PRESENT:cloudflare");
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

test("remote plan detects duplicate and missing triggers on the configured scheduler", () => {
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
  expect(duplicate.blockers).toContain("DUPLICATE_SUPABASE_SCHEDULER_TRIGGERS");
  expect(duplicate.blockers).toContain("CONFIGURED_SCHEDULER_TRIGGER_COUNT_INVALID:supabase");

  const missing = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "supabase",
  }, baseProviders.map((provider) => provider.provider === "supabase"
    ? { ...provider, schedulerInventory: { ...provider.schedulerInventory, triggers: [] } }
    : provider));
  expect(missing.blockers).toContain("CONFIGURED_SCHEDULER_TRIGGER_COUNT_INVALID:supabase");
});

test("selected scheduler scope requires confirmation and rejects an active unselected trigger", () => {
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
  expect(preview.blockers).toContain("SCHEDULER_SCOPE_CONFIRMATION_REQUIRED");
  expect(preview.blockers).toContain("UNSELECTED_SCHEDULER_TRIGGER_PRESENT:cloudflare");
  expect(preview.blockers).not.toContain("SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:vercel");
});

test("the curated hosted footprint does not require unrelated Vercel credentials", () => {
  const providers = [
    {
      provider: "cloudflare" as const, state: "identified" as const, target: "account/worker",
      schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "resource-only" as const, triggers: [] },
      runtimeBindings: { state: "verified" as const, completeness: "selected-runtime" as const, bindings: cloudflareBindings, hyperdrive: { configurationId: "hyperdrive-id", databaseTarget: "verified" as const, runtimeRole: "verified" as const }, configuredScheduler: "supabase" },
      domainRoutes: { state: "verified" as const, completeness: "selected-runtime" as const, domains: [{ hostname: "nova.example.test", source: "custom-domain" as const, enabled: true }] },
      revision: "worker-revision",
    },
    { provider: "netlify" as const, state: "identified" as const, target: "site-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst", schedulerInventory: { scope: "database-project" as const, state: "verified" as const, completeness: "project-scoped" as const, triggers: [{ id: "cron-1", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }] }, migrationInventory: { state: "current" as const, appliedCount: 4, migrationHead: "0004_schema.sql", expectedHead: "0004_schema.sql", checksumsVerified: true } },
    { provider: "nova" as const, state: "identified" as const, runtime: "netlify", origin: "https://nova.example.test", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64) },
  ];
  const preview = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "keep",
  }, providers, true);
  expect(preview.blockers).not.toContain("SCHEDULER_SCOPE_CONFIRMATION_REQUIRED");
  expect(preview.blockers).not.toContain("SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:netlify");
  expect(preview.blockers).not.toContain("SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:cloudflare");
  expect(preview.blockers).not.toContain("SCHEDULER_PROVIDER_INVENTORY_INCOMPLETE:supabase");
  expect(preview.blockers.some((blocker) => blocker.includes("vercel"))).toBe(false);
});

test("scheduler handover requires the target scheduler to be inactive before promotion", () => {
  const providers = [
    {
      provider: "cloudflare" as const, state: "identified" as const, target: "account/worker", revision: "worker-revision",
      schedulerInventory: { scope: "target-runtime" as const, state: "verified" as const, completeness: "resource-only" as const,
        triggers: [{ id: "worker/schedule-1", name: "cloudflare-cron-trigger", schedule: "*/5 * * * *", active: true }] },
      runtimeBindings: { state: "verified" as const, completeness: "selected-runtime" as const, bindings: cloudflareBindings, hyperdrive: { configurationId: "hyperdrive-id", databaseTarget: "verified" as const, runtimeRole: "verified" as const }, configuredScheduler: "cloudflare" },
      domainRoutes: { state: "verified" as const, completeness: "selected-runtime" as const, domains: [{ hostname: "nova.example.test", source: "custom-domain" as const }] },
    },
    { provider: "netlify" as const, state: "identified" as const, target: "site-id", schedulerInventory: { scope: "target-runtime" as const, state: "not-installed" as const, completeness: "project-scoped" as const, triggers: [] } },
    { provider: "supabase" as const, state: "identified" as const, target: "abcdefghijklmnopqrst",
      schedulerInventory: { scope: "database-project" as const, state: "verified" as const, completeness: "project-scoped" as const,
        triggers: [{ id: "cron-1", name: "nova-background-tick", schedule: "*/5 * * * *", active: true }] },
      migrationInventory: { state: "current" as const, appliedCount: 4, migrationHead: "0004_schema.sql", expectedHead: "0004_schema.sql", checksumsVerified: true } },
    { provider: "nova" as const, state: "identified" as const, runtime: "netlify", origin: "https://nova.example.test", configuredScheduler: "supabase", databaseFingerprint: "b".repeat(64) },
  ];
  const preview = buildDeploymentPreview(inventory, {
    runtime: "cloudflare", database: "keep", scheduler: "cloudflare",
  }, providers, true);
  expect(preview.blockers).toContain("TARGET_SCHEDULER_ALREADY_ACTIVE:cloudflare");
  expect(preview.blockers).not.toContain("CONFIGURED_SCHEDULER_TRIGGER_COUNT_INVALID:supabase");
});
