export type AuthHandoffPurpose = "invitation" | "verification" | "password_reset";

/** Contains display data and a host-owned reveal action; no server identifier is exposed. */
export interface AuthHandoffView {
  /** Ephemeral view identity, generated locally and unrelated to the server handoff ID. */
  viewKey: string;
  purpose: AuthHandoffPurpose;
  targetDisplayName: string;
  targetEmail: string;
  reason: string | null;
  expiresAt: string;
  revealBlocked: boolean;
  onReveal: () => Promise<string>;
}

export type AuthHandoffsReadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; handoffs: readonly AuthHandoffView[] };

export class AuthHandoffActionError extends Error {
  constructor(
    readonly kind: "unavailable" | "rejected" | "unconfirmed",
    message: string,
  ) {
    super(message);
    this.name = "AuthHandoffActionError";
  }
}

export interface AuthHandoffsProps {
  readState: AuthHandoffsReadState;
  canRead: boolean;
  revealPending: boolean;
  onRetry: () => void;
}
