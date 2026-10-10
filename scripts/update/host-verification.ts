import { inspectNovaIdentity } from "../deployment/providers/nova-identity.ts";
import type { ProviderFetcher, ProviderResource } from "../deployment/providers/types.ts";

const fullCommitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

export type HostedCommitVerification =
  | { status: "verified"; checks: number; release: string; runtime?: string; origin: string }
  | { status: "pending"; checks: number; observedRelease?: string; detail?: string; origin: string }
  | { status: "unverifiable"; checks: number; detail: string; origin: string };

export function normalizeHostedDeploymentOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function retryableIdentityFailure(resource: ProviderResource): boolean {
  return resource.state === "unavailable" && Boolean(resource.detail && (
    resource.detail === "REQUEST_FAILED" || resource.detail === "REQUEST_TIMEOUT" ||
    resource.detail === "RATE_LIMITED_RETRY_LATER" || /^PROVIDER_HTTP_5\d\d$/.test(resource.detail) ||
    resource.detail === "TARGET_NOT_FOUND_OR_NOT_VISIBLE"
  ));
}

async function checkPublicReadiness(fetcher: ProviderFetcher, origin: string): Promise<"ready" | "pending" | "unverifiable"> {
  let response: Response;
  try {
    response = await fetcher(new URL("/api/ready", origin), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return "pending";
  }
  if (response.status >= 500 && response.status <= 599) return "pending";
  if (!response.ok) return "unverifiable";
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return "unverifiable";
    const value = body as Record<string, unknown>;
    return value.service === "nova-api" && value.status === "ready" ? "ready" : "unverifiable";
  } catch {
    return "unverifiable";
  }
}

/** Polls the protected runtime identity, then public API readiness; it never changes provider resources. */
export async function waitForHostedCommit(options: {
  origin: string;
  secret: string;
  expectedCommit: string;
  fetcher?: ProviderFetcher;
  wait?: (milliseconds: number) => Promise<void>;
  intervalMs?: number;
  maxChecks?: number;
}): Promise<HostedCommitVerification> {
  const origin = normalizeHostedDeploymentOrigin(options.origin);
  if (!origin) throw new Error("UPDATE_HOST_ORIGIN_INVALID");
  if (!fullCommitPattern.test(options.expectedCommit)) throw new Error("UPDATE_HOST_COMMIT_INVALID");
  if (!options.secret) throw new Error("UPDATE_HOST_IDENTITY_SECRET_REQUIRED");

  const maxChecks = options.maxChecks ?? 21;
  const intervalMs = options.intervalMs ?? 30_000;
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 21 ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 60_000) {
    throw new Error("UPDATE_HOST_POLL_CONFIGURATION_INVALID");
  }
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const fetcher = options.fetcher ?? fetch;
  const environment = {
    NOVA_PUBLIC_ORIGIN: origin,
    NOVA_BACKGROUND_JOB_SECRET: options.secret,
  };
  let lastDetail: string | undefined;
  let observedRelease: string | undefined;

  for (let checks = 1; checks <= maxChecks; checks += 1) {
    const identity = await inspectNovaIdentity(environment, fetcher);
    if (identity.state === "identified") {
      lastDetail = undefined;
      const value = identity.release;
      if (!value || !fullCommitPattern.test(value)) {
        return { status: "unverifiable", checks, detail: "RUNTIME_RELEASE_COMMIT_NOT_FULL_SHA", origin };
      }
      observedRelease = value.toLowerCase();
      if (observedRelease === options.expectedCommit.toLowerCase()) {
        const readiness = await checkPublicReadiness(fetcher, origin);
        if (readiness === "ready") {
          return {
            status: "verified", checks, release: observedRelease, origin,
            ...(identity.runtime ? { runtime: identity.runtime } : {}),
          };
        }
        if (readiness === "unverifiable") {
          return { status: "unverifiable", checks, detail: "PUBLIC_READINESS_RESPONSE_INVALID", origin };
        }
        lastDetail = "PUBLIC_API_NOT_READY";
      }
    } else {
      lastDetail = identity.detail;
      if (!retryableIdentityFailure(identity)) {
        return { status: "unverifiable", checks, detail: lastDetail ?? "RUNTIME_IDENTITY_UNAVAILABLE", origin };
      }
    }

    if (checks < maxChecks) await wait(intervalMs);
  }

  return {
    status: "pending",
    checks: maxChecks,
    ...(observedRelease ? { observedRelease } : {}),
    ...(lastDetail ? { detail: lastDetail } : {}),
    origin,
  };
}
