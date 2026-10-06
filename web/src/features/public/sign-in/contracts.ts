export interface SignInCredentials {
  /** Kept in the sign-in component and passed only to its transient submit callback. */
  email: string;
  password: string;
}

export interface SignInNotice {
  kind: "info" | "success" | "warning" | "error";
  message: string;
}

export interface SignInProps {
  /** The host owns the existing API request and session refresh lifecycle. */
  onSignIn: (credentials: SignInCredentials) => void | Promise<void>;
  /** Existing public-route feedback, such as a completed password reset. */
  notice?: SignInNotice | null;
  /** Navigation remains owned by the route host. */
  onForgotPassword: () => void;
  onBack: () => void;
}
