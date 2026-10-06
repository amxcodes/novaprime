import type { AuthHandoffPurpose, AuthHandoffView } from "./contracts";

const purposes = new Set<AuthHandoffPurpose>(["invitation", "verification", "password_reset"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let nextViewKey = 0;

function createViewKey(): string {
  nextViewKey += 1;
  const randomKey = globalThis.crypto?.randomUUID?.();
  return `handoff-view-${randomKey || nextViewKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Projects only a permission-appropriate, display-safe row; URL and ID never leave the host. */
export function projectAuthHandoff(
  value: unknown,
  allowedPurposes: readonly AuthHandoffPurpose[],
  onReveal: () => Promise<string>,
  revealBlocked = false,
): AuthHandoffView | null {
  if (!isRecord(value)) return null;
  const purpose = value.purpose;
  if (typeof purpose !== "string" || !purposes.has(purpose as AuthHandoffPurpose) || !allowedPurposes.includes(purpose as AuthHandoffPurpose)) return null;

  const targetDisplayName = text(value.targetDisplayName);
  const targetEmail = text(value.targetEmail);
  const expiresAt = timestamp(value.expiresAt);
  if (!targetDisplayName || !targetEmail || !expiresAt || typeof onReveal !== "function") return null;

  return Object.freeze({
    viewKey: createViewKey(),
    purpose: purpose as AuthHandoffPurpose,
    targetDisplayName,
    targetEmail,
    reason: text(value.reason),
    expiresAt,
    revealBlocked,
    onReveal,
  });
}

/** Leaves the host responsible for action closures and rejects malformed list payloads. */
export function projectAuthHandoffList(
  value: unknown,
  allowedPurposes: readonly AuthHandoffPurpose[],
  revealForId: (id: string, purpose: AuthHandoffPurpose) => () => Promise<string>,
  revealIsBlocked: (id: string) => boolean = () => false,
): readonly AuthHandoffView[] | null {
  if (!isRecord(value) || !Array.isArray(value.handoffs)) return null;
  const result: AuthHandoffView[] = [];
  for (const handoff of value.handoffs) {
    if (!isRecord(handoff)) return null;
    const purpose = handoff.purpose;
    if (typeof purpose !== "string" || !purposes.has(purpose as AuthHandoffPurpose)) return null;
    if (!allowedPurposes.includes(purpose as AuthHandoffPurpose)) continue;
    const id = typeof handoff.id === "string" ? handoff.id : "";
    if (!uuidPattern.test(id)) return null;
    const projected = projectAuthHandoff(
      handoff,
      allowedPurposes,
      revealForId(id, purpose as AuthHandoffPurpose),
      revealIsBlocked(id),
    );
    if (!projected) return null;
    result.push(projected);
  }
  return Object.freeze(result);
}
