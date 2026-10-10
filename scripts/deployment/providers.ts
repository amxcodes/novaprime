import { inspectCloudflare } from "./providers/cloudflare.ts";
import { inspectNetlify } from "./providers/netlify.ts";
import { inspectNovaIdentity } from "./providers/nova-identity.ts";
import { inspectSupabase } from "./providers/supabase.ts";
import { inspectVercel } from "./providers/vercel.ts";
import type { ProviderFetcher, ProviderResource } from "./providers/types.ts";

export type { DatabaseMigrationInventory, ProviderFetcher, ProviderName, ProviderResource, SchedulerTriggerInventory } from "./providers/types.ts";

/** Discover only explicitly targeted resources; each provider owns its response parsing. */
export async function discoverProviderResources(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher = fetch,
  options: { probePublicReadiness?: boolean } = {},
): Promise<ProviderResource[]> {
  return await Promise.all([
    inspectNetlify(environment, fetcher),
    inspectCloudflare(environment, fetcher),
    inspectVercel(environment, fetcher),
    inspectSupabase(environment, fetcher),
    inspectNovaIdentity(environment, fetcher, options),
  ]);
}
