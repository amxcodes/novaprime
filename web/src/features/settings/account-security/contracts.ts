export interface AccountIdentityView {
  name: string;
  email: string;
  emailVerified: boolean;
}

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
}

export class AccountSecurityActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountSecurityActionError";
  }
}
