export type ProviderName = "netlify" | "cloudflare" | "vercel" | "supabase" | "nova";

export interface SchedulerTriggerInventory {
  scope: "target-runtime" | "database-project";
  state: "verified" | "not-installed" | "target-required" | "unavailable";
  completeness: "resource-only" | "project-scoped" | "partial" | "not-inspected";
  triggers: Array<{ id: string; name: string; schedule: string | null; active: boolean | null }>;
  detail?: string;
}

export interface DatabaseMigrationInventory {
  state: "current" | "behind" | "ahead" | "diverged" | "unverified" | "not-installed" | "target-required" | "unavailable";
  appliedCount: number | null;
  migrationHead: string | null;
  expectedHead: string | null;
  checksumsVerified: boolean;
  detail?: string;
}

export interface RuntimeBindingInventory {
  state: "verified" | "unavailable" | "not-inspected";
  completeness: "selected-runtime" | "partial" | "not-inspected";
  bindings: Array<{
    name: string;
    type: string;
    scopes: string[];
    contexts: string[];
    secret: boolean;
  }>;
  /** This is retained only for the allowlisted non-secret scheduler selector. */
  configuredScheduler?: string;
  detail?: string;
}

export interface DomainRouteInventory {
  state: "verified" | "unavailable" | "not-inspected";
  completeness: "selected-runtime" | "partial" | "not-inspected";
  domains: Array<{ hostname: string; source: "provider-default" | "custom-domain" }>;
  cloudflareRouting?: {
    state: "verified" | "unavailable";
    completeness: "selected-runtime" | "partial";
    zones: Array<{
      zoneId: string;
      hostnames: string[];
      state: "verified" | "unavailable";
      routes: Array<{ pattern: string; script: string | null }>;
      dnsRecords: Array<{ hostname: string; type: string; proxied: boolean }>;
      detail?: string;
    }>;
    detail?: string;
  };
  detail?: string;
}

export interface ProviderResource {
  provider: ProviderName;
  state: "identified" | "target-required" | "not-configured" | "unavailable";
  target?: string;
  revision?: string;
  runtime?: string;
  runtimeId?: string;
  release?: string;
  origin?: string;
  databaseVersion?: string;
  databaseFingerprint?: string;
  schemaReady?: boolean;
  migrationLedgerPresent?: boolean;
  configuredScheduler?: string;
  schedulerInventory?: SchedulerTriggerInventory;
  migrationInventory?: DatabaseMigrationInventory;
  runtimeBindings?: RuntimeBindingInventory;
  domainRoutes?: DomainRouteInventory;
  detail?: string;
}

export type ProviderFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
