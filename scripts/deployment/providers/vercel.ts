import type { ProviderFetcher, ProviderResource } from "./types.ts";
import { asObject, firstString, getProviderJson, providerFailure, safeHttpsOrigin, safeProviderId, safeReleaseSha } from "./shared.ts";

export async function inspectVercel(
  environment: Readonly<Record<string, string>>,
  fetcher: ProviderFetcher,
): Promise<ProviderResource> {
  const token = environment.VERCEL_TOKEN;
  if (!token) return { provider: "vercel", state: "not-configured" };
  const projectId = safeProviderId(environment.VERCEL_PROJECT_ID);
  if (!projectId) return { provider: "vercel", state: "target-required" };
  try {
    const teamId = safeProviderId(environment.VERCEL_TEAM_ID);
    const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    const project = asObject(await getProviderJson(fetcher,
      `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${teamQuery}`, token, "vercel"));
    if (!project) throw new Error("vercel:RESPONSE_INVALID");
    const deploymentQuery = new URLSearchParams({ projectId, limit: "1", target: "production" });
    if (teamId) deploymentQuery.set("teamId", teamId);
    const deployments = asObject(await getProviderJson(fetcher,
      `https://api.vercel.com/v6/deployments?${deploymentQuery}`, token, "vercel"));
    const latest = Array.isArray(deployments?.deployments) ? asObject(deployments.deployments[0]) : null;
    return {
      provider: "vercel", state: "identified", target: projectId, runtime: "vercel",
      ...(safeReleaseSha(firstString(asObject(latest?.meta)?.githubCommitSha))
        ? { release: safeReleaseSha(firstString(asObject(latest?.meta)?.githubCommitSha)) } : {}),
      ...(safeHttpsOrigin(`https://${firstString(latest?.url) ?? ""}`)
        ? { origin: safeHttpsOrigin(`https://${firstString(latest?.url) ?? ""}`) } : {}),
      schedulerInventory: {
        scope: "target-runtime", state: "target-required", completeness: "partial", triggers: [],
        detail: "VERCEL_CRON_REQUIRES_EXACT_DEPLOY_SOURCE_RECONCILIATION",
      },
      ...(firstString(latest?.readyState) ? { detail: `LATEST_DEPLOY_${String(latest.readyState).toUpperCase()}` } : {}),
    };
  } catch (error) { return providerFailure("vercel", error); }
}
