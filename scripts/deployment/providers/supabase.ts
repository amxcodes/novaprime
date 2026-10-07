import { inspectSupabaseCronInventory } from "../supabase-scheduler-inventory.ts";
import type { ProviderFetcher, ProviderResource, SchedulerTriggerInventory } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure } from "./shared.ts";

export async function inspectSupabase(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher,
): Promise<ProviderResource> {
  const token = environment.SUPABASE_ACCESS_TOKEN;
  if (!token) return { provider: "supabase", state: "not-configured" };
  const projectRef = environment.NOVA_SUPABASE_PROJECT_REF;
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? "")) return { provider: "supabase", state: "target-required" };
  try {
    const [projectValue, healthValue] = await Promise.all([
      getProviderJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}`, token, "supabase"),
      getProviderJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}/health`, token, "supabase"),
    ]);
    const project = asObject(projectValue);
    if (!project) throw new Error("supabase:RESPONSE_INVALID");
    const health = Array.isArray(healthValue) ? healthValue : [];
    const statuses = health.map((item) => firstString(asObject(item)?.status)).filter((item): item is string => Boolean(item));
    const database = asObject(project.database);
    const cron = await inspectSupabaseCronInventory(environment);
    const schedulerInventory: SchedulerTriggerInventory = {
      scope: "database-project",
      state: cron.state,
      completeness: cron.completeness,
      triggers: cron.triggers.map(({ id, name, schedule, active }) => ({ id, name, schedule, active })),
      ...(cron.detail ? { detail: cron.detail } : {}),
    };
    return {
      provider: "supabase", state: "identified", target: projectRef, runtime: "postgresql",
      ...(firstString(database?.version, database?.postgres_engine) ? { databaseVersion: firstString(database?.version, database?.postgres_engine) } : {}),
      schedulerInventory,
      detail: statuses.length ? `SERVICE_HEALTH_${statuses.join(",").toUpperCase()}` : "PROJECT_IDENTIFIED_HEALTH_UNKNOWN",
    };
  } catch (error) { return providerFailure("supabase", error); }
}
