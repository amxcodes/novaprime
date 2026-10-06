export interface AccountIdentityView {
  name: string;
  email: string;
  emailVerified: boolean;
}

export interface AccountSessionView {
  /** Opaque action reference; the corresponding auth token stays in the host adapter. */
  id: string;
  device: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export type AccountSessionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "reauthentication-required"; message: string }
  | { status: "ready"; sessions: readonly AccountSessionView[] };

export type AccountSecurityReadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; identity: AccountIdentityView };

export type AccountSecurityActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export interface AccountSecurityProps {
  readState: AccountSecurityReadState;
  onRequestVerification(): Promise<void>;
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
  onLoadSessions(): Promise<readonly AccountSessionView[]>;
  onRevokeSession(sessionId: string): Promise<void>;
  onRevokeOtherSessions(): Promise<void>;
  onReauthenticate(): Promise<void>;
}

export class AccountSecurityActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountSecurityActionError";
  }
}

export class AccountSessionFreshnessError extends Error {
  constructor() {
    super("Sign out and sign in again to review your active sessions.");
    this.name = "AccountSessionFreshnessError";
  }
}
