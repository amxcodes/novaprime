export interface InvitationAcceptanceValues {
  name: string;
  email: string;
  password: string;
}

export interface InvitationAcceptanceResult {
  verificationSent?: boolean;
}

export interface InvitationAcceptanceNotice {
  kind: "info" | "success" | "warning" | "error";
  message: string;
}

export class InvitationAcceptanceError extends Error {
  constructor(
    readonly kind: "warning" | "error",
    message: string,
  ) {
    super(message);
    this.name = "InvitationAcceptanceError";
  }
}

export interface InvitationAcceptanceProps {
  /** The host retains the invitation token and owns the API, server validation, and navigation. */
  onAccept: (values: InvitationAcceptanceValues) => Promise<void | InvitationAcceptanceResult>;
  /** Whether a token was present in the invite URL before the host removed it. */
  invitationAvailable: boolean;
  /** Return to the sign-in route after accepting an invitation. */
  onBackToSignIn: () => void;
  /** Return to the public landing route when the invitation URL has no token. */
  onReturnToNOVA: () => void;
  /** Optional host-provided public-route feedback, already safe to display. */
  notice?: InvitationAcceptanceNotice | null;
}
