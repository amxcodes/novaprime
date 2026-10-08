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

/** Polls only NOVA's protected, read-only runtime identity; it never changes provider resources. */
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
  const environment = {
    NOVA_PUBLIC_ORIGIN: origin,
    NOVA_BACKGROUND_JOB_SECRET: options.secret,
  };
  let lastDetail: string | undefined;
  let observedRelease: string | undefined;

  for (let checks = 1; checks <= maxChecks; checks += 1) {
    const identity = await inspectNovaIdentity(environment, options.fetcher ?? fetch);
    if (identity.state === "identified") {
      const value = identity.release;
      if (!value || !fullCommitPattern.test(value)) {
        return { status: "unverifiable", checks, detail: "RUNTIME_RELEASE_COMMIT_NOT_FULL_SHA", origin };
      }
      observedRelease = value.toLowerCase();
      if (observedRelease === options.expectedCommit.toLowerCase()) {
        return {
          status: "verified", checks, release: observedRelease, origin,
          ...(identity.runtime ? { runtime: identity.runtime } : {}),
        };
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
