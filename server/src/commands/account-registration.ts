import { createHash, timingSafeEqual } from "node:crypto";
import { authenticationConfiguration, bootstrapToken } from "../auth-configuration.js";
import { database } from "../db.js";
import { activeEmailConnection } from "./email-connections.js";

type RegistrationInput = Readonly<{
  email: string;
  invitationToken?: string;
  name: string;
  password: string;
}>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

function registrationInput(body: unknown, invitationRequired: boolean): RegistrationInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;
  const email = typeof candidate.email === "string"
    ? candidate.email.trim().toLowerCase()
    : "";
  const invitationToken = typeof candidate.invitationToken === "string"
    ? candidate.invitationToken
    : undefined;
  if (
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    typeof candidate.password !== "string" ||
    !candidate.password ||
    !emailPattern.test(email) ||
    (invitationRequired && (!invitationToken || invitationToken.length < 32))
  ) {
    return undefined;
  }

  return Object.freeze({
    email,
    ...(invitationToken ? { invitationToken } : {}),
    name: candidate.name.trim(),
    password: candidate.password,
  });
}

function tokenMatches(supplied: string | null): boolean {
  if (!supplied) {
    return false;
  }

  const expected = Buffer.from(bootstrapToken());
  const received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function invitationHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

async function internalRegistration(
  request: Request,
  input: RegistrationInput,
  invitationAcceptance = false,
): Promise<Response> {
  const { internalAuth, invitationAuth } = await import("../auth.js");
  const configuration = authenticationConfiguration();
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  if (input.invitationToken) {
    headers.set("x-nova-invitation-token", input.invitationToken);
  }

  const authInstance = invitationAcceptance ? invitationAuth : internalAuth;
  return authInstance.handler(new Request(
    new URL("/api/auth/sign-up/email", configuration.baseUrl),
    {
      body: JSON.stringify({
        email: input.email,
        name: input.name,
        password: input.password,
      }),
      headers,
      method: "POST",
    },
  ));
}

async function sendVerificationEmail(
  request: Request,
  email: string,
): Promise<Response> {
  const { internalAuth } = await import("../auth.js");
  const configuration = authenticationConfiguration();
  const headers = new Headers(request.headers);
  // Invitation acceptance may happen in a browser that still has another
  // NOVA user's session (for example, on a shared workstation). This internal
  // verification request belongs to the new invitee, so never forward the
  // caller's authentication credentials into Better Auth's email-mismatch
  // guard.
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("x-nova-bootstrap-token");
  headers.delete("x-nova-invitation-token");
  headers.set("content-type", "application/json");
  return internalAuth.handler(new Request(
    new URL("/api/auth/send-verification-email", configuration.baseUrl),
    {
      body: JSON.stringify({ email }),
      headers,
      method: "POST",
    },
  ));
}

async function registrationResponse(
  registration: Response,
  request: Request,
  email: string,
): Promise<Response> {
  if (!registration.ok) {
    return registration;
  }

  const headers = new Headers(registration.headers);
  const payload: unknown = await registration.json().catch(() => ({}));
  const verification = await sendVerificationEmail(request, email);
  const connection = await activeEmailConnection().catch(() => undefined);
  if (!verification.ok || !connection) {
    return json(
      { ...((typeof payload === "object" && payload !== null) ? payload : {}), verificationSent: false },
      202,
      headers,
    );
  }

  return json(
    { ...((typeof payload === "object" && payload !== null) ? payload : {}), verificationSent: true },
    201,
    headers,
  );
}

export async function registerFounder(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
    if (!tokenMatches(request.headers.get("x-nova-bootstrap-token"))) {
      return json({ error: "ORGANISATION_BOOTSTRAP_TOKEN_INVALID" }, 403);
    }
  } catch {
    return json({ error: "ORGANISATION_BOOTSTRAP_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "FOUNDER_REGISTRATION_INPUT_INVALID" }, 400);
  }
  const input = registrationInput(body, false);
  if (!input) {
    return json({ error: "FOUNDER_REGISTRATION_INPUT_INVALID" }, 400);
  }

  const available = await database().query<{ available: boolean }>(
    "SELECT nova.bootstrap_auth_signup_available() AS available",
  );
  if (available.rows[0]?.available !== true) {
    return json({ error: "ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED" }, 409);
  }

  try {
    return await internalRegistration(request, input);
  } catch {
    return json({ error: "FOUNDER_REGISTRATION_FAILED" }, 422);
  }
}

export async function acceptInvitation(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVITATION_ACCEPTANCE_INPUT_INVALID" }, 400);
  }
  const input = registrationInput(body, true);
  if (!input?.invitationToken) {
    return json({ error: "INVITATION_ACCEPTANCE_INPUT_INVALID" }, 400);
  }

  const claimable = await database().query<{ claimable: boolean }>(
    "SELECT nova.invitation_is_claimable($1, $2) AS claimable",
    [input.email, invitationHash(input.invitationToken)],
  );
  if (claimable.rows[0]?.claimable !== true) {
    return json({ error: "INVITATION_INVALID_OR_EXPIRED" }, 422);
  }

  try {
    return await registrationResponse(
      await internalRegistration(request, input, true),
      request,
      input.email,
    );
  } catch {
    return json({ error: "INVITATION_ACCEPTANCE_FAILED" }, 422);
  }
}
