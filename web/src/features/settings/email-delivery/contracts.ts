export type EmailProviderKind = "console" | "smtp" | "gmail_oauth2" | "resend";

export interface SmtpEmailCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}

export interface GmailEmailCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ResendEmailCredentials {
  apiKey: string;
}

interface EmailConnectionCreateBase {
  name: string;
  senderEmail: string;
  replyToEmail?: string;
}

/** Credentials exist only in the form draft and this transient create command. */
export type CreateEmailConnectionInput = EmailConnectionCreateBase & (
  | { provider: "console" }
  | { provider: "smtp"; credentials: SmtpEmailCredentials }
  | { provider: "gmail_oauth2"; credentials: GmailEmailCredentials }
  | { provider: "resend"; credentials: ResendEmailCredentials }
);

export type EmailTestStatus = "untested" | "passed" | "failed";
export type EmailDeliveryActionFailureKind = "conflict" | "error" | "unconfirmed";

export class EmailDeliveryActionError extends Error {
  constructor(readonly kind: EmailDeliveryActionFailureKind, message: string) {
    super(message);
    this.name = "EmailDeliveryActionError";
  }
}

/**
 * HTTP client errors with a definitive 4xx response did not complete the
 * requested action. A 5xx or transport failure can happen after commit, so
 * callers must reconcile the saved connection before inviting a retry.
 */
export function classifyEmailDeliveryActionFailure(error: unknown): EmailDeliveryActionFailureKind {
  if (error instanceof EmailDeliveryActionError) return error.kind;
  const status = typeof error === "object" && error !== null && "httpStatus" in error
    ? (error as { httpStatus?: unknown }).httpStatus
    : undefined;
  if (Number.isInteger(status) && (status as number) >= 400 && (status as number) < 500) return "error";
  return "unconfirmed";
}

/** Display-only connection metadata. IDs and credentials stay in the host/API boundary. */
export interface EmailConnectionView {
  name: string;
  provider: EmailProviderKind;
  senderEmail: string;
  replyToEmail: string | null;
  isActive: boolean;
  supported: boolean;
  lastTestedAt: string | null;
  lastTestStatus: EmailTestStatus;
  onTest: (recipientEmail: string) => Promise<void>;
  onActivate: () => Promise<void>;
  onDeactivate: () => Promise<void>;
  onConnectGoogle?: () => Promise<void>;
}

export type EmailConnectionReadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

export interface EmailDeliveryProps {
  readState: EmailConnectionReadState;
  /** null while the separate public-origin read is pending. */
  publicOriginConfigured: boolean | null;
  /** Explicit host capability for a Super Admin whose separate origin-read grant is absent. */
  canActWithUnknownPublicOrigin?: boolean;
  publicOriginError?: string;
  publicOrigin?: string;
  supportedProviders: readonly string[];
  runtimeNotice?: string;
  connections: readonly EmailConnectionView[];
  oauthResult?: { status: "success" | "pending" | "error"; message: string };
  onRetry: () => void;
  onRetryOrigin?: () => void;
  /** Reject with a user-safe EmailDeliveryActionError; credentials remain in the form on failure. */
  onCreate: (input: CreateEmailConnectionInput) => Promise<void>;
}
