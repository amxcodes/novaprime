import type { AccountIdentityView, AccountSessionView } from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Projects the signed-in identity only; session and credential fields never enter the feature. */
export function projectAccountIdentity(value: unknown): AccountIdentityView | null {
  if (!isRecord(value) || typeof value.email !== "string" || typeof value.emailVerified !== "boolean") return null;
  const email = value.email.trim();
  if (!email) return null;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : email;
  return Object.freeze({ name, email, emailVerified: value.emailVerified });
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deviceLabel(userAgent: unknown): string {
  if (typeof userAgent !== "string") return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /(?:Chrome|CriOS)\//.test(userAgent) ? "Chrome"
    : /(?:Safari)\//.test(userAgent) && !/(?:Chrome|CriOS|Edg)\//.test(userAgent) ? "Safari"
    : null;
  const platform = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Macintosh|Mac OS X/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  return browser && platform ? `${browser} on ${platform}` : browser || platform || "Unknown device";
}

/**
 * Removes Better Auth's token, IP address, user-agent, and unknown fields
 * before session rows cross into React.
 */
export function projectAccountSessions(value: unknown, currentSessionId: string | null): readonly AccountSessionView[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const sessions = value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim() ||
      typeof candidate.token !== "string" || !candidate.token) return [];
    const lastActiveAt = timestamp(candidate.updatedAt) || timestamp(candidate.createdAt);
    if (!lastActiveAt) return [];
    return [Object.freeze({
      id: candidate.id,
      device: deviceLabel(candidate.userAgent),
      lastActiveAt,
      isCurrent: candidate.id === currentSessionId,
    })];
  });
  return Object.freeze(sessions);
}
