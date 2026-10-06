import type { PublicOriginSnapshot } from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function origin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Projects the server response into the public origin fields this feature renders. */
export function projectPublicOrigin(value: unknown): PublicOriginSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.allowedOrigins)) return null;
  const effectiveOrigin = origin(value.effectiveOrigin);
  if (!effectiveOrigin) return null;

  const allowedOrigins = [...new Set(value.allowedOrigins.map(origin).filter((item): item is string => item !== null))];
  if (!allowedOrigins.includes(effectiveOrigin)) return null;
  const configuredOrigin = value.configuredOrigin === null ? null : origin(value.configuredOrigin);
  if (value.configuredOrigin !== null && !configuredOrigin) return null;
  if (configuredOrigin && !allowedOrigins.includes(configuredOrigin)) return null;

  return Object.freeze({
    configuredOrigin,
    effectiveOrigin,
    allowedOrigins: Object.freeze(allowedOrigins),
  });
}
