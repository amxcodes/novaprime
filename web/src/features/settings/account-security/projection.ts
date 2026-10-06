import type { AccountIdentityView } from "./contracts";

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
