export interface PasswordRecoveryProps {
  /** The host owns the request, same-origin redirect URL, and post-submit route. */
  onRequestReset: (email: string) => void | Promise<void>;
  /** The route host owns sign-in navigation. */
  onBackToSignIn: () => void;
}
