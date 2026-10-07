import type { ProviderFetcher, ProviderName, ProviderResource } from "./types.ts";

export const providerIdPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const timeoutMs = 10_000;
const maxResponseBytes = 1_000_000;

export function safeProviderId(value: string | undefined): string | undefined {
  return value && providerIdPattern.test(value) ? value : undefined;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

export function safeHttpsOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.origin;
  } catch { return undefined; }
}

export function safeReleaseSha(value: string | undefined): string | undefined {
  return value && /^(?:[a-f0-9]{7,64})$/i.test(value) ? value.toLowerCase() : undefined;
}

function providerHttpError(status: number): string {
  if (status === 401) return "CREDENTIAL_REJECTED";
  if (status === 403) return "MISSING_READ_PERMISSION";
  if (status === 404) return "TARGET_NOT_FOUND_OR_NOT_VISIBLE";
  if (status === 429) return "RATE_LIMITED_RETRY_LATER";
  return `PROVIDER_HTTP_${status}`;
}

export async function getProviderJson<T>(
  fetcher: ProviderFetcher,
  url: string,
  token: string,
  provider: ProviderName,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error && error.name === "TimeoutError" ? "REQUEST_TIMEOUT" : "REQUEST_FAILED";
    throw new Error(`${provider}:${name}`);
  }
  if (!response.ok) throw new Error(`${provider}:${providerHttpError(response.status)}`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxResponseBytes) throw new Error(`${provider}:RESPONSE_TOO_LARGE`);
  let body: string;
  try { body = await response.text(); }
  catch { throw new Error(`${provider}:RESPONSE_READ_FAILED`); }
  if (Buffer.byteLength(body, "utf8") > maxResponseBytes) throw new Error(`${provider}:RESPONSE_TOO_LARGE`);
  try { return JSON.parse(body) as T; }
  catch { throw new Error(`${provider}:RESPONSE_INVALID`); }
}

export function providerFailure(provider: ProviderName, error: unknown): ProviderResource {
  const detail = error instanceof Error && /^(netlify|cloudflare|vercel|supabase|nova):[A-Z0-9_:-]+$/.test(error.message)
    ? error.message.split(":").slice(1).join(":")
    : "PROVIDER_READ_FAILED";
  return { provider, state: "unavailable", detail };
}
