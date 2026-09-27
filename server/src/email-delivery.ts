import nodemailer from "nodemailer";

export type EmailProviderKind = "console" | "smtp" | "gmail_oauth2" | "resend";

const nodeEmailProviders: readonly EmailProviderKind[] = ["console", "smtp", "gmail_oauth2", "resend"];
const httpsEmailProviders: readonly EmailProviderKind[] = ["gmail_oauth2", "resend"];

export function supportedEmailProviders(runtime = process.env.NOVA_EMAIL_RUNTIME): readonly EmailProviderKind[] {
  return runtime === "https" ? httpsEmailProviders : nodeEmailProviders;
}

export function emailProviderSupported(
  provider: EmailProviderKind,
  runtime = process.env.NOVA_EMAIL_RUNTIME,
): boolean {
  return supportedEmailProviders(runtime).includes(provider);
}

export type EmailMessage = Readonly<{
  messageId?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}>;

export type EmailConnection = Readonly<{
  id: string;
  provider: EmailProviderKind;
  senderEmail: string;
  replyToEmail?: string;
  credentials: unknown;
}>;

export class EmailDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const smtpConnectionTimeoutMs = 10_000;
const smtpSocketTimeoutMs = 15_000;
const httpDeliveryTimeoutMs = 10_000;

function assertRuntimeSupportsProvider(provider: EmailProviderKind): void {
  // Gmail API and Resend use HTTPS and work on Workers and Node. SMTP sockets
  // and the development console are available only on Node/VPS runtimes.
  if (!emailProviderSupported(provider)) {
    throw new EmailDeliveryError("EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME");
  }
}

type SmtpCredentials = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}>;

type GmailOAuthCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}>;

type ResendCredentials = Readonly<{ apiKey: string }>;

function smtpCredentials(value: unknown): SmtpCredentials {
  if (typeof value !== "object" || value === null) {
    throw new EmailDeliveryError("EMAIL_CONNECTION_CREDENTIALS_INVALID");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.host !== "string" ||
    !candidate.host ||
    typeof candidate.port !== "number" ||
    !Number.isInteger(candidate.port) ||
    candidate.port < 1 ||
    candidate.port > 65535 ||
    typeof candidate.secure !== "boolean" ||
    typeof candidate.username !== "string" ||
    !candidate.username ||
    typeof candidate.password !== "string" ||
    !candidate.password
  ) {
    throw new EmailDeliveryError("EMAIL_CONNECTION_CREDENTIALS_INVALID");
  }

  return Object.freeze({
    host: candidate.host,
    port: candidate.port,
    secure: candidate.secure,
    username: candidate.username,
    password: candidate.password,
  });
}

function gmailOAuthCredentials(value: unknown): GmailOAuthCredentials {
  if (typeof value !== "object" || value === null) {
    throw new EmailDeliveryError("EMAIL_CONNECTION_CREDENTIALS_INVALID");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.clientId !== "string" ||
    !candidate.clientId ||
    typeof candidate.clientSecret !== "string" ||
    !candidate.clientSecret ||
    typeof candidate.refreshToken !== "string" ||
    !candidate.refreshToken
  ) {
    throw new EmailDeliveryError("EMAIL_CONNECTION_NOT_CONNECTED");
  }

  return Object.freeze({
    clientId: candidate.clientId,
    clientSecret: candidate.clientSecret,
    refreshToken: candidate.refreshToken,
  });
}

function resendCredentials(value: unknown): ResendCredentials {
  if (typeof value !== "object" || value === null) {
    throw new EmailDeliveryError("EMAIL_CONNECTION_CREDENTIALS_INVALID");
  }

  const apiKey = (value as Record<string, unknown>).apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new EmailDeliveryError("EMAIL_CONNECTION_CREDENTIALS_INVALID");
  }

  return Object.freeze({ apiKey });
}

function sender(connection: EmailConnection): Readonly<{
  from: string;
  replyTo?: string;
}> {
  return Object.freeze({
    from: connection.senderEmail,
    ...(connection.replyToEmail ? { replyTo: connection.replyToEmail } : {}),
  });
}

async function gmailAccessToken(credentials: GmailOAuthCredentials): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(httpDeliveryTimeoutMs),
  });
  const tokenBody: unknown = await response.json().catch(() => undefined);
  const accessToken = typeof tokenBody === "object" && tokenBody !== null
    ? (tokenBody as Record<string, unknown>).access_token
    : undefined;
  if (!response.ok || typeof accessToken !== "string" || !accessToken) {
    throw new EmailDeliveryError("EMAIL_PROVIDER_DELIVERY_FAILED");
  }
  return accessToken;
}

async function gmailRawMessage(
  connection: EmailConnection,
  message: EmailMessage,
): Promise<string> {
  // Nodemailer's MIME composer is transport-independent; actual delivery uses
  // Gmail's HTTPS API so this adapter also runs in Cloudflare Workers.
  const composer = nodemailer.createTransport({
    buffer: true,
    newline: "unix",
    streamTransport: true,
  });
  const composed = await composer.sendMail({ ...sender(connection), ...message });
  if (!Buffer.isBuffer(composed.message)) {
    throw new EmailDeliveryError("EMAIL_PROVIDER_DELIVERY_FAILED");
  }
  return composed.message.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendGmailApi(
  connection: EmailConnection,
  message: EmailMessage,
  credentials: GmailOAuthCredentials,
): Promise<string> {
  const accessToken = await gmailAccessToken(credentials);
  const raw = await gmailRawMessage(connection, message);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    body: JSON.stringify({ raw }),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(httpDeliveryTimeoutMs),
  });
  const result: unknown = await response.json().catch(() => undefined);
  const id = typeof result === "object" && result !== null
    ? (result as Record<string, unknown>).id
    : undefined;
  if (!response.ok || typeof id !== "string" || !id) {
    throw new EmailDeliveryError("EMAIL_PROVIDER_DELIVERY_FAILED");
  }
  return id;
}

function normalizedMessage(message: EmailMessage): EmailMessage {
  if (
    !message.to ||
    !message.subject ||
    !message.text ||
    /[\r\n]/.test(message.to) ||
    /[\r\n]/.test(message.subject) ||
    (message.messageId !== undefined &&
      (message.messageId.length > 256 || /[\r\n]/.test(message.messageId)))
  ) {
    throw new EmailDeliveryError("EMAIL_MESSAGE_INVALID");
  }

  return message;
}

export async function sendEmail(
  connection: EmailConnection,
  requestedMessage: EmailMessage,
): Promise<string | undefined> {
  const message = normalizedMessage(requestedMessage);

  try {
    assertRuntimeSupportsProvider(connection.provider);

    if (connection.provider === "console") {
      // ponytail: local-only sink; add a captured-mail test adapter only when UI tests need it.
      console.info(`[NOVA console email] to=${message.to} subject=${message.subject}`);
      console.info(message.text);
      return message.messageId;
    }

    if (connection.provider === "smtp") {
      const credentials = smtpCredentials(connection.credentials);
      const transporter = nodemailer.createTransport({
        auth: { pass: credentials.password, user: credentials.username },
        connectionTimeout: smtpConnectionTimeoutMs,
        greetingTimeout: smtpConnectionTimeoutMs,
        host: credentials.host,
        port: credentials.port,
        // Password-authenticated SMTP must upgrade to TLS when using
        // STARTTLS; never silently send credentials over a clear channel.
        requireTLS: !credentials.secure,
        secure: credentials.secure,
        socketTimeout: smtpSocketTimeoutMs,
      });
      const result = await transporter.sendMail({ ...sender(connection), ...message });
      return result.messageId;
    }

    if (connection.provider === "gmail_oauth2") {
      const credentials = gmailOAuthCredentials(connection.credentials);
      return await sendGmailApi(connection, message, credentials);
    }

    if (connection.provider === "resend") {
      const credentials = resendCredentials(connection.credentials);
      const response = await fetch("https://api.resend.com/emails", {
        body: JSON.stringify({
          from: connection.senderEmail,
          html: message.html,
          reply_to: connection.replyToEmail,
          subject: message.subject,
          text: message.text,
          to: [message.to],
          headers: message.messageId ? { "Message-ID": message.messageId } : undefined,
        }),
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          "content-type": "application/json",
          ...(message.messageId ? { "idempotency-key": message.messageId } : {}),
        },
        method: "POST",
        signal: AbortSignal.timeout(httpDeliveryTimeoutMs),
      });

      if (!response.ok) {
        throw new EmailDeliveryError("EMAIL_PROVIDER_DELIVERY_FAILED");
      }
      const result = await response.json().catch(() => undefined) as { id?: unknown } | undefined;
      if (!result || typeof result.id !== "string" || !result.id) {
        throw new EmailDeliveryError("EMAIL_PROVIDER_DELIVERY_FAILED");
      }
      return result.id;
    }

    throw new EmailDeliveryError("EMAIL_PROVIDER_UNSUPPORTED");
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      throw error;
    }

    throw new EmailDeliveryError("EMAIL_PROVIDER_DELIVERY_FAILED");
  }
}
