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

export interface ProviderResource {
  provider: ProviderName;
  state: "identified" | "target-required" | "not-configured" | "unavailable";
  target?: string;
  runtime?: string;
  release?: string;
  origin?: string;
  databaseVersion?: string;
  databaseFingerprint?: string;
  schemaReady?: boolean;
  migrationLedgerPresent?: boolean;
  configuredScheduler?: string;
  schedulerInventory?: SchedulerTriggerInventory;
  migrationInventory?: DatabaseMigrationInventory;
  detail?: string;
}

export type ProviderFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
