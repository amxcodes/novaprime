import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import {
  type EmailConnection,
  EmailDeliveryError,
  type EmailProviderKind,
  emailProviderSupported,
  sendEmail,
  supportedEmailProviders,
} from "../email-delivery.js";
import {
  database,
  databaseRequestContext,
  withDatabaseRequest,
  type DatabaseRequestContext,
} from "../db.js";
import { requestActor, type RequestActor } from "../request-actor.js";
import { decryptSecret, encryptSecret } from "../secrets.js";
import {
  configuredPublicOrigins,
  configuredPublicOriginForOrganisation,
  publicOriginForOrganisation,
  requestPublicOrigin,
} from "../public-origin.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const gmailOAuthTimeoutMs = 10_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providers = new Set<EmailProviderKind>([
  "console",
  "smtp",
  "gmail_oauth2",
  "resend",
]);

type SmtpInput = Readonly<{
  host: string;
  password: string;
  port: number;
  secure: boolean;
  username: string;
}>;

type GmailInput = Readonly<{ clientId: string; clientSecret: string }>;
type ResendInput = Readonly<{ apiKey: string }>;

type CreateConnectionInput = Readonly<{
  credentials?: SmtpInput | GmailInput | ResendInput;
  name: string;
  provider: EmailProviderKind;
  replyToEmail?: string;
  senderEmail: string;
}>;

type ConnectionRow = Readonly<{
  credentials_ciphertext: Buffer | null;
  credentials_key_version: number | null;
  id: string;
  is_active: boolean;
  last_test_error_code: string | null;
  last_tested_at: Date | null;
  name: string;
  provider: EmailProviderKind;
  reply_to_email: string | null;
  sender_email: string;
}>;

type ActiveConnectionRow = Readonly<{
  connection_id: string;
  credentials_ciphertext: Buffer | null;
  credentials_key_version: number | null;
  provider: EmailProviderKind;
  reply_to_email: string | null;
  sender_email: string;
}>;

type OAuthAttemptRow = Readonly<{
  connection_id: string;
  credentials_ciphertext: Buffer;
  credentials_key_version: number;
  initiator_person_id: string;
  organisation_id: string;
  pkce_verifier_ciphertext: Buffer;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function gmailCallbackResult(
  request: Request,
  result:
    | Readonly<{ connected: true; connectionId: string }>
    | Readonly<{ error: string }>,
  status = 200,
  origin?: string,
): Response {
  // Google returns a browser navigation here. API clients can still request the
  // JSON contract explicitly; browsers return to the same-origin settings UI.
  if (request.headers.get("accept")?.includes("text/html")) {
    let destination: URL;
    try {
      destination = new URL("/", origin ?? requestPublicOrigin(request));
    } catch {
      return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
    }
    if ("connectionId" in result) {
      destination.searchParams.set("gmail", "connected");
      destination.searchParams.set("connectionId", result.connectionId);
    } else {
      destination.searchParams.set("gmail", "failed");
      destination.searchParams.set("error", result.error);
    }
    return Response.redirect(destination, 303);
  }

  return json(result, status);
}

function normalizedEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const email = value.trim().toLowerCase();
  return emailPattern.test(email) ? email : undefined;
}

function credentialsFrom(
  provider: EmailProviderKind,
  value: unknown,
): CreateConnectionInput["credentials"] | undefined {
  if (provider === "console") {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (provider === "smtp") {
    if (
      typeof candidate.host !== "string" ||
      !candidate.host.trim() ||
      typeof candidate.port !== "number" ||
      !Number.isInteger(candidate.port) ||
      candidate.port < 1 ||
      candidate.port > 65535 ||
      typeof candidate.secure !== "boolean" ||
      typeof candidate.username !== "string" ||
      !candidate.username.trim() ||
      typeof candidate.password !== "string" ||
      !candidate.password
    ) {
      return undefined;
    }

    return Object.freeze({
      host: candidate.host.trim(),
      password: candidate.password,
      port: candidate.port,
      secure: candidate.secure,
      username: candidate.username.trim(),
    });
  }

  if (provider === "gmail_oauth2") {
    if (
      typeof candidate.clientId !== "string" ||
      !candidate.clientId.trim() ||
      typeof candidate.clientSecret !== "string" ||
      !candidate.clientSecret
    ) {
      return undefined;
    }
    return Object.freeze({
      clientId: candidate.clientId.trim(),
      clientSecret: candidate.clientSecret,
    });
  }

  if (typeof candidate.apiKey !== "string" || !candidate.apiKey) {
    return undefined;
  }
  return Object.freeze({ apiKey: candidate.apiKey });
}

export function createEmailConnectionInput(
  body: unknown,
): CreateConnectionInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;
  const provider = candidate.provider;
  const senderEmail = normalizedEmail(candidate.senderEmail);
  const replyToEmail = candidate.replyToEmail === undefined
    ? undefined
    : normalizedEmail(candidate.replyToEmail);

  if (
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    typeof provider !== "string" ||
    !providers.has(provider as EmailProviderKind) ||
    !senderEmail ||
    (provider === "console" && candidate.credentials !== undefined) ||
    (candidate.replyToEmail !== undefined && !replyToEmail)
  ) {
    return undefined;
  }

  const credentials = credentialsFrom(
    provider as EmailProviderKind,
    candidate.credentials,
  );
  if (provider !== "console" && !credentials) {
    return undefined;
  }

  return Object.freeze({
    ...(credentials ? { credentials } : {}),
    name: candidate.name.trim(),
    provider: provider as EmailProviderKind,
    ...(replyToEmail ? { replyToEmail } : {}),
    senderEmail,
  });
}

function connectionMetadata(row: ConnectionRow) {
  return Object.freeze({
    id: row.id,
    isActive: row.is_active,
    lastTestErrorCode: row.last_test_error_code,
    lastTestedAt: row.last_tested_at?.toISOString() ?? null,
    name: row.name,
    provider: row.provider,
    replyToEmail: row.reply_to_email,
    senderEmail: row.sender_email,
  });
}

function connectionFromRow(row: Pick<
  ConnectionRow,
  "credentials_ciphertext" | "id" | "provider" | "reply_to_email" | "sender_email"
>): EmailConnection {
  const credentials = row.provider === "console"
    ? undefined
    : JSON.parse(decryptSecret(row.credentials_ciphertext ?? Buffer.alloc(0)));

  return Object.freeze({
    credentials,
    id: row.id,
    provider: row.provider,
    ...(row.reply_to_email ? { replyToEmail: row.reply_to_email } : {}),
    senderEmail: row.sender_email,
  });
}

async function superAdmin(
  context: DatabaseRequestContext,
): Promise<boolean> {
  return withDatabaseRequest(context, async (transaction) => {
    return activeSuperAdminInTransaction(transaction);
  });
}

async function activeSuperAdminInTransaction(transaction: PoolClient): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT nova.request_actor_is_super_admin()
        AND EXISTS (
          SELECT 1
          FROM nova.person_status_periods statuses
          WHERE statuses.person_id = nova.request_user_id()
            AND statuses.ended_at IS NULL
            AND statuses.status IN ('active', 'notice')
        ) AS permitted`,
  );
  return result.rows[0]?.permitted === true;
}

async function originConfigured(organisationId: string): Promise<boolean> {
  return Boolean(await configuredPublicOriginForOrganisation(organisationId));
}

async function requiredSuperAdmin(request: Request): Promise<
  { actor: RequestActor } | { response: Response }
> {
  try {
    authenticationConfiguration();
  } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }

  const actor = await requestActor(request);
  if (!actor) {
    return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  }
  if (actor.status !== "active" && actor.status !== "notice") {
    return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  }

  if (!await superAdmin(actor.context)) {
    return { response: json({ error: "PERMISSION_DENIED" }, 403) };
  }

  return { actor };
}

async function connectionForActor(
  context: DatabaseRequestContext,
  id: string,
): Promise<ConnectionRow | undefined> {
  return withDatabaseRequest(context, async (transaction) => {
    if (!await activeSuperAdminInTransaction(transaction)) return undefined;
    const result = await transaction.query<ConnectionRow>(
      `SELECT id, name, provider, sender_email, reply_to_email,
        credentials_ciphertext, credentials_key_version, is_active,
        last_tested_at, last_test_error_code
       FROM nova.email_provider_connections
       WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  });
}

export async function activeEmailConnection(): Promise<EmailConnection | undefined> {
  const result = await database().query<ActiveConnectionRow>(
    `SELECT connection_id, provider, sender_email, reply_to_email,
      credentials_ciphertext, credentials_key_version
     FROM nova.active_email_provider_connection()`,
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return connectionFromRow({
    credentials_ciphertext: row.credentials_ciphertext,
    id: row.connection_id,
    provider: row.provider,
    reply_to_email: row.reply_to_email,
    sender_email: row.sender_email,
  });
}

export async function listEmailConnections(request: Request): Promise<Response> {
  const access = await requiredSuperAdmin(request);
  if ("response" in access) {
    return access.response;
  }

  try {
    const connections = await withDatabaseRequest(access.actor.context, async (transaction) => {
      if (!await activeSuperAdminInTransaction(transaction)) return "PERMISSION_DENIED" as const;
      const result = await transaction.query<ConnectionRow>(
        `SELECT id, name, provider, sender_email, reply_to_email,
          credentials_ciphertext, credentials_key_version, is_active,
          last_tested_at, last_test_error_code
         FROM nova.email_provider_connections
         ORDER BY created_at ASC`,
      );
      return result.rows.map(connectionMetadata);
    });
    if (connections === "PERMISSION_DENIED") return json({ error: connections }, 403);
    return json({ connections, supportedProviders: supportedEmailProviders() });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createEmailConnection(request: Request): Promise<Response> {
  const access = await requiredSuperAdmin(request);
  if ("response" in access) {
    return access.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "EMAIL_CONNECTION_INPUT_INVALID" }, 400);
  }
  const input = createEmailConnectionInput(body);
  if (!input) {
    return json({ error: "EMAIL_CONNECTION_INPUT_INVALID" }, 400);
  }
  if (!await originConfigured(access.actor.context.organisationId)) {
    return json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, 409);
  }
  if (!emailProviderSupported(input.provider)) {
    return json({ error: "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME" }, 422);
  }

  try {
    const encryptedCredentials = input.provider === "console"
      ? null
      : encryptSecret(JSON.stringify(input.credentials));
    const result = await withDatabaseRequest(access.actor.context, async (transaction) => {
      if (!await activeSuperAdminInTransaction(transaction)) return "PERMISSION_DENIED" as const;
      const inserted = await transaction.query<ConnectionRow>(
        `INSERT INTO nova.email_provider_connections (
          name, provider, sender_email, reply_to_email,
          credentials_ciphertext, credentials_key_version
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, provider, sender_email, reply_to_email,
          credentials_ciphertext, credentials_key_version, is_active,
          last_tested_at, last_test_error_code`,
        [
          input.name,
          input.provider,
          input.senderEmail,
          input.replyToEmail ?? null,
          encryptedCredentials,
          encryptedCredentials ? 1 : null,
        ],
      );
      const connection = inserted.rows[0];
      if (!connection) {
        throw new Error("EMAIL_CONNECTION_CREATE_RESULT_MISSING");
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'email.connection.created', 'email_provider_connection', $3, $4)`,
        [
          access.actor.context.organisationId,
          access.actor.context.userId,
          connection.id,
          JSON.stringify({ name: connection.name, provider: connection.provider }),
        ],
      );
      return connectionMetadata(connection);
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ connection: result }, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return json({ error: "EMAIL_CONNECTION_ALREADY_EXISTS" }, 409);
    }
    if (error instanceof Error && error.message === "SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED") {
      return json({ error: "SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED" }, 503);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

async function recordTest(
  context: DatabaseRequestContext,
  connectionId: string,
  errorCode: string | null,
): Promise<void> {
  await withDatabaseRequest(context, async (transaction) => {
    if (!await activeSuperAdminInTransaction(transaction)) return;
    await transaction.query(
      `UPDATE nova.email_provider_connections
       SET last_tested_at = now(), last_test_error_code = $2, updated_at = now()
       WHERE id = $1`,
      [connectionId, errorCode],
    );
  });
}

export async function testEmailConnection(
  request: Request,
  connectionId: string,
): Promise<Response> {
  const access = await requiredSuperAdmin(request);
  if ("response" in access) {
    return access.response;
  }
  if (!uuidPattern.test(connectionId)) {
    return json({ error: "EMAIL_CONNECTION_NOT_FOUND" }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "EMAIL_TEST_INPUT_INVALID" }, 400);
  }
  const recipient = normalizedEmail(
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).recipientEmail
      : undefined,
  );
  if (!recipient) {
    return json({ error: "EMAIL_TEST_INPUT_INVALID" }, 400);
  }

  try {
    const row = await connectionForActor(access.actor.context, connectionId);
    if (!row) {
      return json({ error: "EMAIL_CONNECTION_NOT_FOUND" }, 404);
    }
    if (!await originConfigured(access.actor.context.organisationId)) {
      return json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, 409);
    }
    const connection = connectionFromRow(row);
    await sendEmail(connection, {
      subject: "NOVA email connection test",
      text: "This confirms that this NOVA email connection can send mail.",
      to: recipient,
    });
    await recordTest(access.actor.context, connectionId, null);
    return json({ delivered: true });
  } catch (error) {
    const errorCode = error instanceof EmailDeliveryError
      ? error.code
      : error instanceof Error && error.message === "SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED"
      ? error.message
      : "EMAIL_PROVIDER_DELIVERY_FAILED";
    await recordTest(access.actor.context, connectionId, errorCode).catch(() => undefined);
    return json({ error: errorCode }, 422);
  }
}

export async function activateEmailConnection(
  request: Request,
  connectionId: string,
): Promise<Response> {
  const access = await requiredSuperAdmin(request);
  if ("response" in access) {
    return access.response;
  }
  if (!uuidPattern.test(connectionId)) {
    return json({ error: "EMAIL_CONNECTION_NOT_FOUND" }, 404);
  }

  try {
    const result = await withDatabaseRequest(access.actor.context, async (transaction) => {
      if (!await activeSuperAdminInTransaction(transaction)) return "PERMISSION_DENIED" as const;
      const origin = await transaction.query<{ public_origin: string | null }>(
        "SELECT public_origin FROM nova.organisation_runtime_settings WHERE organisation_id = $1",
        [access.actor.context.organisationId],
      );
      if (!origin.rows[0]?.public_origin || !configuredPublicOrigins().includes(origin.rows[0].public_origin)) {
        return "PUBLIC_ORIGIN_NOT_CONFIGURED" as const;
      }
      const target = await transaction.query<ConnectionRow>(
        `SELECT id, name, provider, sender_email, reply_to_email,
          credentials_ciphertext, credentials_key_version, is_active,
          last_tested_at, last_test_error_code
         FROM nova.email_provider_connections
         WHERE id = $1
         FOR UPDATE`,
        [connectionId],
      );
      const connection = target.rows[0];
      if (!connection) {
        return "EMAIL_CONNECTION_NOT_FOUND" as const;
      }
      if (!emailProviderSupported(connection.provider)) {
        return "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME" as const;
      }
      if (!connection.last_tested_at || connection.last_test_error_code) {
        return "EMAIL_CONNECTION_NOT_TESTED" as const;
      }

      await transaction.query(
        "UPDATE nova.email_provider_connections SET is_active = false, updated_at = now() WHERE is_active",
      );
      await transaction.query(
        "UPDATE nova.email_provider_connections SET is_active = true, updated_at = now() WHERE id = $1",
        [connectionId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'email.connection.activated', 'email_provider_connection', $3, $4)`,
        [
          access.actor.context.organisationId,
          access.actor.context.userId,
          connectionId,
          JSON.stringify({ provider: connection.provider }),
        ],
      );
      return connectionMetadata({ ...connection, is_active: true });
    });

    if (result === "EMAIL_CONNECTION_NOT_FOUND") {
      return json({ error: result }, 404);
    }
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "EMAIL_CONNECTION_NOT_TESTED") {
      return json({ error: result }, 409);
    }
    if (result === "PUBLIC_ORIGIN_NOT_CONFIGURED") {
      return json({ error: result }, 409);
    }
    if (result === "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME") {
      return json({ error: result }, 422);
    }
    return json({ connection: result });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function deactivateEmailConnection(
  request: Request,
  connectionId: string,
): Promise<Response> {
  const access = await requiredSuperAdmin(request);
  if ("response" in access) return access.response;
  if (!uuidPattern.test(connectionId)) return json({ error: "EMAIL_CONNECTION_NOT_FOUND" }, 404);

  try {
    const result = await withDatabaseRequest(access.actor.context, async (transaction) => {
      if (!await activeSuperAdminInTransaction(transaction)) return "PERMISSION_DENIED" as const;
      const target = await transaction.query<ConnectionRow>(
        `SELECT id, name, provider, sender_email, reply_to_email,
                credentials_ciphertext, credentials_key_version, is_active,
                last_tested_at, last_test_error_code
         FROM nova.email_provider_connections
         WHERE id = $1
         FOR UPDATE`,
        [connectionId],
      );
      const connection = target.rows[0];
      if (!connection) return "EMAIL_CONNECTION_NOT_FOUND" as const;
      await transaction.query(
        "UPDATE nova.email_provider_connections SET is_active = false, updated_at = now() WHERE id = $1",
        [connectionId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
           organisation_id, actor_person_id, action, target_type, target_id, details
         ) VALUES ($1, $2, 'email.connection.deactivated', 'email_provider_connection', $3, $4)`,
        [access.actor.context.organisationId, access.actor.context.userId, connectionId, JSON.stringify({ provider: connection.provider })],
      );
      return connectionMetadata({ ...connection, is_active: false });
    });
    if (result === "EMAIL_CONNECTION_NOT_FOUND") return json({ error: result }, 404);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ connection: result });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

function gmailCredentials(value: unknown): GmailInput | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.clientId !== "string" ||
    !candidate.clientId ||
    typeof candidate.clientSecret !== "string" ||
    !candidate.clientSecret
  ) {
    return undefined;
  }
  return Object.freeze({
    clientId: candidate.clientId,
    clientSecret: candidate.clientSecret,
  });
}

function callbackUrl(origin = authenticationConfiguration().baseUrl): string {
  return new URL(
    "/api/email-connections/gmail/callback",
    origin,
  ).toString();
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export async function beginGmailConnection(
  request: Request,
  connectionId: string,
): Promise<Response> {
  const access = await requiredSuperAdmin(request);
  if ("response" in access) {
    return access.response;
  }
  if (!uuidPattern.test(connectionId)) {
    return json({ error: "EMAIL_CONNECTION_NOT_FOUND" }, 404);
  }
  if (!emailProviderSupported("gmail_oauth2")) {
    return json({ error: "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME" }, 422);
  }
  if (!await originConfigured(access.actor.context.organisationId)) {
    return json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, 409);
  }

  try {
    const row = await connectionForActor(access.actor.context, connectionId);
    if (!row || row.provider !== "gmail_oauth2") {
      return json({ error: "GMAIL_CONNECTION_NOT_FOUND" }, 404);
    }
    const credentials = gmailCredentials(
      JSON.parse(decryptSecret(row.credentials_ciphertext ?? Buffer.alloc(0))),
    );
    if (!credentials) {
      return json({ error: "EMAIL_CONNECTION_CREDENTIALS_INVALID" }, 422);
    }

    const state = randomBytes(32).toString("base64url");
    const pkceVerifier = randomBytes(32).toString("base64url");
    const pkceChallenge = hash(pkceVerifier).toString("base64url");
    const result = await withDatabaseRequest(access.actor.context, async (transaction) => {
      if (!await activeSuperAdminInTransaction(transaction)) return "PERMISSION_DENIED" as const;
      // OAuth attempts are short-lived protocol state. Prune expired rows at
      // the existing setup boundary so repeated reconnects cannot grow the
      // table indefinitely, without adding another scheduler dependency.
      await transaction.query(
        "DELETE FROM nova.email_oauth_attempts WHERE expires_at <= now()",
      );
      await transaction.query(
        `INSERT INTO nova.email_oauth_attempts (
          connection_id, initiator_person_id, state_hash, pkce_verifier_ciphertext, expires_at
        ) VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
        [
          connectionId,
          access.actor.context.userId,
          hash(state),
          encryptSecret(pkceVerifier),
        ],
      );
      return "STARTED" as const;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    const origin = await publicOriginForOrganisation(access.actor.context.organisationId);

    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      access_type: "offline",
      client_id: credentials.clientId,
      code_challenge: pkceChallenge,
      code_challenge_method: "S256",
      include_granted_scopes: "true",
      login_hint: row.sender_email,
      prompt: "consent",
      redirect_uri: callbackUrl(origin),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/gmail.send",
      state,
    }).toString();
    return json({ authorizationUrl: authorizationUrl.toString() });
  } catch (error) {
    if (error instanceof Error && error.message === "SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED") {
      return json({ error: error.message }, 503);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function completeGmailConnection(request: Request): Promise<Response> {
  if (!emailProviderSupported("gmail_oauth2")) {
    return gmailCallbackResult(request, { error: "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME" }, 422);
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const authorizationCode = url.searchParams.get("code");
  if (!state || !authorizationCode || url.searchParams.get("error")) {
    return gmailCallbackResult(request, { error: "GMAIL_OAUTH_CALLBACK_INVALID" }, 400);
  }

  try {
    const consumed = await database().query<OAuthAttemptRow>(
      `SELECT connection_id, initiator_person_id, credentials_ciphertext,
        organisation_id, credentials_key_version, pkce_verifier_ciphertext
       FROM nova.consume_email_oauth_attempt($1)`,
      [hash(state)],
    );
    const attempt = consumed.rows[0];
    if (!attempt) {
      return gmailCallbackResult(request, { error: "GMAIL_OAUTH_STATE_INVALID" }, 400);
    }
    const origin = await publicOriginForOrganisation(attempt.organisation_id);

    const credentials = gmailCredentials(
      JSON.parse(decryptSecret(attempt.credentials_ciphertext)),
    );
    if (!credentials) {
      return gmailCallbackResult(
        request,
        { error: "EMAIL_CONNECTION_CREDENTIALS_INVALID" },
        422,
        origin,
      );
    }
    const pkceVerifier = decryptSecret(attempt.pkce_verifier_ciphertext);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code: authorizationCode,
        code_verifier: pkceVerifier,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl(origin),
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(gmailOAuthTimeoutMs),
    });
    const tokenBody: unknown = await tokenResponse.json().catch(() => undefined);
    const refreshToken = typeof tokenBody === "object" && tokenBody !== null
      ? (tokenBody as Record<string, unknown>).refresh_token
      : undefined;
    const grantedScope = typeof tokenBody === "object" && tokenBody !== null
      ? (tokenBody as Record<string, unknown>).scope
      : undefined;
    if (
      !tokenResponse.ok ||
      typeof refreshToken !== "string" || !refreshToken ||
      typeof grantedScope !== "string" ||
      !grantedScope.split(/\s+/).includes("https://www.googleapis.com/auth/gmail.send")
    ) {
      return gmailCallbackResult(
        request,
        { error: "GMAIL_OAUTH_TOKEN_EXCHANGE_FAILED" },
        422,
        origin,
      );
    }

    const context = databaseRequestContext(
      attempt.initiator_person_id,
      attempt.organisation_id,
    );
    const callbackResult = await withDatabaseRequest(context, async (transaction) => {
      if (!await activeSuperAdminInTransaction(transaction)) return "PERMISSION_DENIED" as const;
      await transaction.query(
        `UPDATE nova.email_provider_connections
         SET credentials_ciphertext = $2, credentials_key_version = 1,
           last_tested_at = NULL, last_test_error_code = NULL, updated_at = now()
         WHERE id = $1 AND provider = 'gmail_oauth2'`,
        [
          attempt.connection_id,
          encryptSecret(JSON.stringify({ ...credentials, refreshToken })),
        ],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'email.connection.gmail_connected', 'email_provider_connection', $3, '{}'::jsonb)`,
        [context.organisationId, context.userId, attempt.connection_id],
      );
      return "CONNECTED" as const;
    });

    if (callbackResult === "PERMISSION_DENIED") {
      return gmailCallbackResult(request, { error: "ACCOUNT_NOT_OPERATIONAL" }, 403, origin);
    }

    return gmailCallbackResult(
      request,
      { connected: true, connectionId: attempt.connection_id },
      200,
      origin,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      ["SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED", "SECRETS_CIPHERTEXT_INVALID"].includes(error.message)
    ) {
      return gmailCallbackResult(request, { error: error.message }, 503);
    }
    return gmailCallbackResult(request, { error: "GMAIL_OAUTH_CALLBACK_FAILED" }, 422);
  }
}
