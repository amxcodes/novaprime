export interface PasswordResetProps {
  /** The host owns the reset request; the opaque token never enters component props. */
  onResetPassword: (newPassword: string) => void | Promise<void>;
  /** Whether the host found a usable token before scrubbing the URL. */
  linkAvailable: boolean;
  /** Public-route navigation remains owned by the host. */
  onRequestNewLink: () => void;
  onBackToSignIn: () => void;
}

/** A reset token rejected by the server is not safe to retry from this screen. */
export class PasswordResetLinkError extends Error {
  constructor() {
    super("PASSWORD_RESET_LINK_INVALID");
    this.name = "PasswordResetLinkError";
  }
}
