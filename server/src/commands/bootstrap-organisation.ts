import { timingSafeEqual } from "node:crypto";
import { authenticationConfiguration, bootstrapToken } from "../auth-configuration.js";
import { authenticationSession } from "../authentication-session.js";
import { database } from "../db.js";

type AttendancePolicyMode = "hour_based" | "scheduled";
type BootstrapRequest = Readonly<{
  attendanceMode: AttendancePolicyMode;
  organisationName: string;
  requiredAttendanceMinutes: number;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function inputFrom(body: unknown): BootstrapRequest | undefined {
  if (
    typeof body !== "object" ||
    body === null ||
    !("organisationName" in body) ||
    typeof body.organisationName !== "string" ||
    !body.organisationName.trim()
  ) {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;
  const attendanceMode = candidate.attendanceMode === "scheduled" ? "scheduled" :
    candidate.attendanceMode === "hour_based" ? "hour_based" : undefined;
  const requiredAttendanceMinutes = candidate.requiredAttendanceMinutes ?? 480;
  if (!attendanceMode || typeof requiredAttendanceMinutes !== "number" ||
    !Number.isInteger(requiredAttendanceMinutes) ||
    requiredAttendanceMinutes < 1 || requiredAttendanceMinutes > 1440) {
    return undefined;
  }

  return {
    attendanceMode,
    organisationName: body.organisationName.trim(),
    requiredAttendanceMinutes,
  };
}

function matchesBootstrapToken(request: Request): boolean {
  const supplied = request.headers.get("x-nova-bootstrap-token");
  const expected = bootstrapToken();

  if (!supplied) {
    return false;
  }

  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);

  return suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function bootstrapOrganisation(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  try {
    if (!matchesBootstrapToken(request)) {
      return json({ error: "ORGANISATION_BOOTSTRAP_TOKEN_INVALID" }, 403);
    }
  } catch {
    return json({ error: "ORGANISATION_BOOTSTRAP_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "ORGANISATION_BOOTSTRAP_INPUT_INVALID" }, 400);
  }

  const input = inputFrom(body);
  if (!input) {
    return json({ error: "ORGANISATION_BOOTSTRAP_INPUT_INVALID" }, 400);
  }

  const session = await authenticationSession(request);
  if (!session) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }

  try {
    const result = await database().query<{ organisation_id: string }>(
      "SELECT nova.bootstrap_organisation($1, $2, $3, $4, $5::nova.attendance_policy_mode, $6) AS organisation_id",
      [
        input.organisationName,
        session.email,
        session.displayName,
        session.identitySubject,
        input.attendanceMode,
        input.requiredAttendanceMinutes,
      ],
    );

    return json({ organisationId: result.rows[0]?.organisation_id }, 201);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED")
    ) {
      return json({ error: "ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED" }, 409);
    }

    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
