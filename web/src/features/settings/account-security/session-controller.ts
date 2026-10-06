import type { AccountSessionView } from "./contracts";
import { AccountSessionFreshnessError } from "./contracts";
import { projectAccountSessions } from "./projection";

type SessionRequest = (path: string, method: "GET" | "POST", body?: Record<string, string>) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionNotFresh(error: unknown): boolean {
  return isRecord(error) && error.code === "SESSION_NOT_FRESH";
}

/** Keeps auth tokens in this adapter's closure; React receives display rows and opaque IDs only. */
export function createAccountSessionController(request: SessionRequest) {
  let tokenBySessionId = new Map<string, string>();
  let currentSessionId: string | null = null;

  async function load(): Promise<readonly AccountSessionView[]> {
    tokenBySessionId = new Map();
    currentSessionId = null;
    let sessions: unknown;
    let current: unknown;
    try {
      [sessions, current] = await Promise.all([
        request("/api/auth/list-sessions", "GET"),
        request("/api/auth/get-session", "GET"),
      ]);
    } catch (error) {
      if (sessionNotFresh(error)) throw new AccountSessionFreshnessError();
      throw error;
    }

    const resolvedCurrentSessionId = isRecord(current) && isRecord(current.session) && typeof current.session.id === "string"
      ? current.session.id
      : null;
    if (!resolvedCurrentSessionId || !Array.isArray(sessions)) {
      throw new Error("NOVA could not identify the current sign-in session. Refresh Settings before continuing.");
    }
    const nextTokens = new Map<string, string>();
    for (const session of sessions) {
      if (isRecord(session) && typeof session.id === "string" && session.id.trim() &&
        typeof session.token === "string" && session.token) {
        nextTokens.set(session.id, session.token);
      }
    }
    tokenBySessionId = nextTokens;
    currentSessionId = resolvedCurrentSessionId;
    return projectAccountSessions(sessions, resolvedCurrentSessionId);
  }

  async function revoke(sessionId: string): Promise<void> {
    await load();
    if (sessionId === currentSessionId) throw new Error("The current session cannot be signed out from this list.");
    const token = tokenBySessionId.get(sessionId);
    if (!token) throw new Error("That session is no longer in the active list. Refresh and try again.");
    await request("/api/auth/revoke-session", "POST", { token });
    tokenBySessionId.delete(sessionId);
  }

  async function revokeOthers(): Promise<void> {
    await load();
    await request("/api/auth/revoke-other-sessions", "POST");
    tokenBySessionId = new Map();
  }

  return Object.freeze({ load, revoke, revokeOthers });
}
