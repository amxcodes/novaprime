import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  authenticationConfiguration,
  authenticationIpAddressHeaders,
} from "./auth-configuration.js";
import { activeEmailConnection } from "./commands/email-connections.js";
import { stageAuthHandoffForIdentity, type AuthHandoffPurpose } from "./commands/auth-handoffs.js";
import { database } from "./db.js";
import { sendEmail } from "./email-delivery.js";
import {
  configuredPublicOrigins,
  configuredPublicHosts,
  configuredPublicOriginForIdentity,
  rebasePublicUrl,
} from "./public-origin.js";

const configuration = authenticationConfiguration();
const authenticationHandoffTtlSeconds = 60 * 60;

function invitationTokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function authPoolSize(): number {
  const configured = Number(process.env.NOVA_AUTH_POOL_MAX ?? 5);
  return Number.isInteger(configured) && configured >= 1 && configured <= 25
    ? configured
    : 5;
}

function authenticationDatabasePool(): Pool {
  // Hyperdrive is already the connection pool for Workers. The database proxy
  // resolves to a request-scoped client there; Node hosts keep Better Auth's
  // independently bounded pool.
  return process.env.NOVA_DATABASE_REQUEST_SCOPED === "true"
    ? database()
    : new Pool({ connectionString: configuration.databaseUrl, max: authPoolSize() });
}

function trustProxyHeaders(): boolean {
  return process.env.NOVA_TRUST_PROXY_HEADERS === "true";
}

async function deliverAuthenticationEmail(
  to: string,
  subject: string,
  text: string,
  handoff: Readonly<{ identitySubject: string; purpose: AuthHandoffPurpose; url: string }>,
): Promise<void> {
  const origin = await configuredPublicOriginForIdentity(handoff.identitySubject);
  if (!origin) {
    throw new Error("PUBLIC_ORIGIN_NOT_CONFIGURED");
  }
  const deliveryUrl = rebasePublicUrl(handoff.url, origin);
  // Deliberately await this narrow adapter call: NOVA must know whether the
  // provider failed so it can stage the encrypted one-time handoff before the
  // Better Auth request completes. Provider failures are converted to the
  // same handoff path rather than leaking a provider exception to the caller.
  try {
    const connection = await activeEmailConnection();
    if (connection) {
      await sendEmail(connection, { subject, text: text.replace(handoff.url, deliveryUrl), to });
      return;
    }
  } catch (error) {
    // A configured provider can be temporarily unavailable or malformed. The
    // secure one-time handoff is the same recovery path used when email is
    // intentionally disabled; never strand a user behind a provider outage.
    console.error(`[NOVA auth email] provider delivery deferred: ${error instanceof Error ? error.message : "EMAIL_PROVIDER_DELIVERY_FAILED"}`);
  }

  let staged = false;
  try {
    staged = await stageAuthHandoffForIdentity(
      handoff.identitySubject,
      handoff.purpose,
      deliveryUrl,
      authenticationHandoffTtlSeconds,
    );
  } catch (error) {
    console.error(`[NOVA auth handoff] staging failed: ${error instanceof Error ? error.message : "AUTH_HANDOFF_STAGE_FAILED"}`);
  }
  if (!staged) {
    throw new Error("EMAIL_CONNECTION_NOT_ACTIVE");
  }
}

async function canCreateAuthenticationSession(identitySubject: string): Promise<boolean> {
  const result = await database().query<{ allowed: boolean }>(
    "SELECT nova.can_create_auth_session($1) AS allowed",
    [identitySubject],
  );
  return result.rows[0]?.allowed === true;
}

function buildAuth(options: Readonly<{
  allowInternalSignUp: boolean;
  autoSignIn: boolean;
  claimInvitationAfterSignUp: boolean;
}>) {
  return betterAuth({
    appName: "NOVA",
    basePath: "/api/auth",
    baseURL: {
      allowedHosts: [...configuredPublicHosts()],
      fallback: configuration.baseUrl,
      protocol: "auto",
    },
    trustedOrigins: async () => {
      try {
        const origins = await database().query<{ origin: string | null }>(
          "SELECT origin FROM nova.configured_public_origins()",
        );
        const allowed = configuredPublicOrigins();
        return [...allowed, ...origins.rows.flatMap((row) =>
          row.origin && allowed.includes(row.origin) ? [row.origin] : [])];
      } catch {
        return [...configuredPublicOrigins()];
      }
    },
    advanced: {
      trustedProxyHeaders: trustProxyHeaders(),
      // Never trust a client-supplied forwarded address on a directly exposed
      // VPS. In that mode Better Auth uses its safe shared deployment bucket;
      // the direct Node adapter supplies a private socket-IP header instead;
      // a configured reverse proxy/edge may opt into its canonical headers.
      ipAddress: {
        ipAddressHeaders: authenticationIpAddressHeaders(),
      },
    },
    database: {
      dialect: new PostgresDialect({
        pool: authenticationDatabasePool(),
      }),
      schemaName: "nova_auth",
      type: "postgres",
    },
    // Keep authentication throttling shared across every API instance. The
    // database-backed store is part of the portable PostgreSQL schema, so a
    // serverless scale-out cannot reset the limiter by moving to another
    // worker/function instance. Better Auth's endpoint-specific rules still
    // apply to sign-in, sign-up, password and verification flows.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 10,
      max: 100,
    },
    emailAndPassword: {
      disableSignUp: !options.allowInternalSignUp,
      enabled: true,
      // Invitation acceptance must establish credentials without creating a
      // session for an unverified, not-yet-onboarded person. Founder setup uses
      // the regular internal instance and still needs its bootstrap session.
      autoSignIn: options.autoSignIn,
      resetPasswordTokenExpiresIn: authenticationHandoffTtlSeconds,
      // A password reset is a security boundary. Keep only the fresh session
      // Better Auth creates, instead of leaving previously stolen sessions live.
      revokeSessionsOnPasswordReset: true,
      requireEmailVerification: !options.allowInternalSignUp,
      sendResetPassword: async ({ url, user }) => {
        await deliverAuthenticationEmail(
          user.email,
          "Reset your NOVA password",
          `Use this secure link to reset your NOVA password:\n\n${url}`,
          { identitySubject: user.id, purpose: "password_reset", url },
        );
      },
    },
    emailVerification: {
      expiresIn: authenticationHandoffTtlSeconds,
      afterEmailVerification: async (user) => {
        await database().query(
          "SELECT nova.complete_invitation_after_email_verification($1)",
          [user.id],
        );
      },
      sendOnSignUp: false,
      sendVerificationEmail: async ({ url, user }) => {
        await deliverAuthenticationEmail(
          user.email,
          "Verify your NOVA email address",
          `Use this secure link to verify your NOVA email address:\n\n${url}`,
          { identitySubject: user.id, purpose: "verification", url },
        );
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) =>
            (await canCreateAuthenticationSession(session.userId)) || false,
        },
      },
      ...(options.claimInvitationAfterSignUp
        ? {
          user: {
            create: {
              after: async (user, context) => {
                const token = context?.request?.headers.get("x-nova-invitation-token");
                if (!token) {
                  return;
                }

                const claimed = await database().query<{ claimed: boolean }>(
                  "SELECT nova.claim_invitation_identity($1, $2, $3) AS claimed",
                  [user.id, user.email.toLowerCase(), invitationTokenHash(token)],
                );
                if (claimed.rows[0]?.claimed !== true) {
                  throw new Error("INVITATION_CLAIM_FAILED");
                }
              },
            },
          },
        }
        : {}),
    },
    secret: configuration.secret,
  });
}

// This handler is the only browser-exposed Better Auth instance. Public account
// creation is disabled; NOVA routes narrowly invoke internalAuth after proving a
// deployment bootstrap token or an invitation token.
export const auth = buildAuth({
  allowInternalSignUp: false,
  autoSignIn: true,
  claimInvitationAfterSignUp: false,
});

const internalAuth = buildAuth({
  allowInternalSignUp: true,
  autoSignIn: true,
  claimInvitationAfterSignUp: true,
});

const invitationAuth = buildAuth({
  allowInternalSignUp: true,
  autoSignIn: false,
  claimInvitationAfterSignUp: true,
});

export { internalAuth, invitationAuth };
