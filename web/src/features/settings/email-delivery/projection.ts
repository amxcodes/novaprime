import type { EmailConnectionView, EmailProviderKind, EmailTestStatus } from "./contracts";

const providerKinds = new Set<EmailProviderKind>(["console", "smtp", "gmail_oauth2", "resend"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerKind(value: unknown): EmailProviderKind | null {
  return typeof value === "string" && providerKinds.has(value as EmailProviderKind)
    ? value as EmailProviderKind
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Returns only server-supported, known provider values in stable order. */
export function projectSupportedEmailProviders(value: unknown): readonly EmailProviderKind[] {
  if (!Array.isArray(value)) return [];
  const available = new Set(value.map(providerKind).filter((provider): provider is EmailProviderKind => provider !== null));
  return Object.freeze(["console", "smtp", "gmail_oauth2", "resend"].filter((provider) => available.has(provider as EmailProviderKind)) as EmailProviderKind[]);
}

/** Drops raw IDs, credential fields, and unknown DTO fields before the row enters React. */
export function projectEmailConnection(
  value: unknown,
  supported: boolean,
  actions: Pick<EmailConnectionView, "onTest" | "onActivate" | "onDeactivate" | "onConnectGoogle">,
): EmailConnectionView | null {
  if (!isRecord(value)) return null;
  const provider = providerKind(value.provider);
  const name = optionalString(value.name);
  const senderEmail = optionalString(value.senderEmail);
  if (!provider || !name || !senderEmail || typeof value.isActive !== "boolean") return null;

  const lastTestedAt = timestamp(value.lastTestedAt);
  const hasTestError = typeof value.lastTestErrorCode === "string" && Boolean(value.lastTestErrorCode.trim());
  const lastTestStatus: EmailTestStatus = !lastTestedAt
    ? "untested"
    : hasTestError ? "failed" : "passed";

  return Object.freeze({
    name,
    provider,
    senderEmail,
    replyToEmail: optionalString(value.replyToEmail),
    isActive: value.isActive,
    supported,
    lastTestedAt,
    lastTestStatus,
    onTest: actions.onTest,
    onActivate: actions.onActivate,
    onDeactivate: actions.onDeactivate,
    ...(actions.onConnectGoogle ? { onConnectGoogle: actions.onConnectGoogle } : {}),
  });
}
