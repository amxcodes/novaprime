import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type OfficeInput = Readonly<{
  latitude: number;
  longitude: number;
  location: string;
  name: string;
  timezone: string;
  geofenceRadiusMeters: number;
}>;
type DepartmentInput = Readonly<{ name: string }>;
type AttendancePolicyMode = "hour_based" | "scheduled";
type AttendancePolicyInput = Readonly<{
  effectiveOn: string;
  mode: AttendancePolicyMode;
  requiredAttendanceMinutes: number;
}>;
type CompleteOnboardingInput = Readonly<{
  designation: string;
  employmentStartsOn: string;
  managerPersonId?: string;
  officeId: string;
  organisationDepartmentId: string;
  personId: string;
  roleId: string;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function nonEmptyString(value: unknown, maximum = 180): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const result = value.trim();
  return result && result.length <= maximum ? result : undefined;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

function validTimezone(value: unknown): value is string {
  const timezone = nonEmptyString(value, 120);
  if (!timezone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function officeInput(body: unknown): OfficeInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const candidate = body as Record<string, unknown>;
  const name = nonEmptyString(candidate.name);
  const location = nonEmptyString(candidate.location, 320);
  const latitude = candidate.latitude;
  const longitude = candidate.longitude;
  const geofenceRadiusMeters = candidate.geofenceRadiusMeters;
  if (!name || !location || !validTimezone(candidate.timezone) ||
    typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    typeof geofenceRadiusMeters !== "number" || !Number.isInteger(geofenceRadiusMeters) ||
    geofenceRadiusMeters < 10 || geofenceRadiusMeters > 100000) {
    return undefined;
  }
  return Object.freeze({ location, name, timezone: candidate.timezone.trim(), latitude, longitude, geofenceRadiusMeters });
}

export function departmentInput(body: unknown): DepartmentInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const name = nonEmptyString((body as Record<string, unknown>).name);
  return name ? Object.freeze({ name }) : undefined;
}

export function attendancePolicyInput(body: unknown): AttendancePolicyInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const mode = candidate.mode;
  const requiredAttendanceMinutes = candidate.requiredAttendanceMinutes;
  if ((mode !== "hour_based" && mode !== "scheduled") ||
    typeof requiredAttendanceMinutes !== "number" ||
    !Number.isInteger(requiredAttendanceMinutes) ||
    requiredAttendanceMinutes < 1 || requiredAttendanceMinutes > 1440) {
    return undefined;
  }
  const effectiveOn = candidate.effectiveOn ?? new Date().toISOString().slice(0, 10);
  if (!validDate(effectiveOn)) return undefined;
  return Object.freeze({ effectiveOn, mode, requiredAttendanceMinutes });
}

export function completeOnboardingInput(body: unknown): CompleteOnboardingInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const candidate = body as Record<string, unknown>;
  const personId = candidate.personId;
  const officeId = candidate.officeId;
  const organisationDepartmentId = candidate.organisationDepartmentId;
  const roleId = candidate.roleId;
  const designation = nonEmptyString(candidate.designation);
  const managerPersonId = candidate.managerPersonId;
  const managerIsValid = managerPersonId === undefined ||
    managerPersonId === null ||
    (typeof managerPersonId === "string" && uuidPattern.test(managerPersonId));
  if (
    typeof personId !== "string" || !uuidPattern.test(personId) ||
    typeof officeId !== "string" || !uuidPattern.test(officeId) ||
    typeof organisationDepartmentId !== "string" || !uuidPattern.test(organisationDepartmentId) ||
    typeof roleId !== "string" || !uuidPattern.test(roleId) ||
    !validDate(candidate.employmentStartsOn) ||
    !designation ||
    !managerIsValid ||
    managerPersonId === personId
  ) {
    return undefined;
  }

  return Object.freeze({
    designation,
    employmentStartsOn: candidate.employmentStartsOn,
    ...(typeof managerPersonId === "string" ? { managerPersonId } : {}),
    officeId,
    organisationDepartmentId,
    personId,
    roleId,
  });
}

async function hasOrganisationPermission(
  transaction: PoolClient,
  actorId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM nova.person_role_assignments assignments
      JOIN nova.roles roles ON roles.id = assignments.role_id
      JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
      WHERE assignments.person_id = $1
        AND assignments.effective_on <= nova.person_business_date($1)
        AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
        AND roles.archived_at IS NULL
        AND grants.permission_key = $2
        AND grants.scope = 'organisation'
    ) AS permitted`,
    [actorId, permissionKey],
  );
  return result.rows[0]?.permitted === true;
}

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try {
    authenticationConfiguration();
  } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }
  const actor = await requestActor(request);
  if (!actor) {
    return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  }
  if (!isNormalOperationalActor(actor)) {
    return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  }
  return { context: actor.context };
}

async function requestBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function createOffice(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) {
    return actor.response;
  }
  const input = officeInput(await requestBody(request));
  if (!input) {
    return json({ error: "OFFICE_INPUT_INVALID" }, 400);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(
        transaction,
        actor.context.userId,
        "organisation.settings.manage",
      ) || !await hasOrganisationPermission(
        transaction,
        actor.context.userId,
        "availability.office_geofence.manage",
      )) {
        return "PERMISSION_DENIED" as const;
      }
      const office = await transaction.query<{ id: string }>(
        `INSERT INTO nova.offices (
          organisation_id, name, location, timezone, latitude, longitude, attendance_geofence_radius_meters
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [actor.context.organisationId, input.name, input.location, input.timezone,
          input.latitude, input.longitude, input.geofenceRadiusMeters],
      );
      const officeId = office.rows[0]?.id;
      if (!officeId) {
        throw new Error("OFFICE_CREATE_RESULT_MISSING");
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'organisation.office.created', 'office', $3, $4)`,
        [
          actor.context.organisationId,
          actor.context.userId,
          officeId,
          JSON.stringify({ timezone: input.timezone, latitude: input.latitude, longitude: input.longitude,
            geofence_radius_meters: input.geofenceRadiusMeters }),
        ],
      );
      return officeId;
    });

    if (result === "PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    return json({ officeId: result }, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return json({ error: "OFFICE_ALREADY_EXISTS" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateOfficeGeofence(request: Request, officeId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(officeId)) return json({ error: "OFFICE_NOT_FOUND" }, 404);
  const body = await requestBody(request);
  const candidate = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const latitude = candidate.latitude;
  const longitude = candidate.longitude;
  const geofenceRadiusMeters = candidate.geofenceRadiusMeters;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    typeof geofenceRadiusMeters !== "number" || !Number.isInteger(geofenceRadiusMeters) ||
    geofenceRadiusMeters < 10 || geofenceRadiusMeters > 100000) {
    return json({ error: "OFFICE_GEOFENCE_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.office_geofence.manage")) {
        return "PERMISSION_DENIED" as const;
      }
      const updated = await transaction.query<{ id: string }>(
        `UPDATE nova.offices
         SET latitude = $2, longitude = $3, attendance_geofence_radius_meters = $4
         WHERE id = $1 AND organisation_id = $5 AND archived_at IS NULL
         RETURNING id`,
        [officeId, latitude, longitude, geofenceRadiusMeters, actor.context.organisationId],
      );
      if (!updated.rows[0]) return "OFFICE_NOT_FOUND" as const;
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'organisation.office.geofence.updated', 'office', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, officeId,
          JSON.stringify({ latitude, longitude, geofence_radius_meters: geofenceRadiusMeters })],
      );
      const people = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_office_assignments assignments
         JOIN nova.person_status_periods statuses
           ON statuses.person_id = assignments.person_id AND statuses.ended_at IS NULL
         WHERE assignments.office_id = $1
           AND assignments.effective_on <= nova.person_business_date(assignments.person_id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))
           AND statuses.status IN ('active', 'notice')`,
        [officeId],
      );
      for (const person of people.rows) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: person.person_id,
          eventKey: "availability.policy_changed",
          title: "Attendance geofence changed",
          body: "Your office attendance location boundary was updated.",
          aggregateType: "office",
          aggregateId: officeId,
          deepLink: "/?view=today",
          idempotencyKey: `availability.geofence_changed:${officeId}:${person.person_id}:${geofenceRadiusMeters}:${latitude}:${longitude}`,
        });
      }
      return officeId;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "OFFICE_NOT_FOUND") return json({ error: result }, 404);
    return json({ officeId: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function createOrganisationDepartment(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) {
    return actor.response;
  }
  const input = departmentInput(await requestBody(request));
  if (!input) {
    return json({ error: "ORGANISATION_DEPARTMENT_INPUT_INVALID" }, 400);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(
        transaction,
        actor.context.userId,
        "organisation.settings.manage",
      )) {
        return "PERMISSION_DENIED" as const;
      }
      const department = await transaction.query<{ id: string }>(
        `INSERT INTO nova.organisation_departments (organisation_id, name)
         VALUES ($1, $2)
         RETURNING id`,
        [actor.context.organisationId, input.name],
      );
      const departmentId = department.rows[0]?.id;
      if (!departmentId) {
        throw new Error("ORGANISATION_DEPARTMENT_CREATE_RESULT_MISSING");
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'organisation.department.created', 'organisation_department', $3, '{}'::jsonb)`,
        [actor.context.organisationId, actor.context.userId, departmentId],
      );
      return departmentId;
    });

    if (result === "PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    return json({ organisationDepartmentId: result }, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return json({ error: "ORGANISATION_DEPARTMENT_ALREADY_EXISTS" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateAttendancePolicy(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = attendancePolicyInput(await requestBody(request));
  if (!input) return json({ error: "ATTENDANCE_POLICY_INPUT_INVALID" }, 400);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "organisation.settings.manage")) {
        return "PERMISSION_DENIED" as const;
      }
      const businessDate = await transaction.query<{ date: string }>(
        "SELECT nova.person_business_date($1)::text AS date",
        [actor.context.userId],
      );
      const today = businessDate.rows[0]?.date ?? new Date().toISOString().slice(0, 10);
      if (input.effectiveOn < today) return "ATTENDANCE_POLICY_DATE_INVALID" as const;

      const current = await transaction.query<{ id: string; effective_on: string }>(
        `SELECT id, effective_on::text
         FROM nova.organisation_attendance_policies
         WHERE organisation_id = $1
           AND effective_on <= $2::date
           AND (effective_until IS NULL OR effective_until >= $2::date)
         ORDER BY effective_on DESC
         LIMIT 1
         FOR UPDATE`,
        [actor.context.organisationId, input.effectiveOn],
      );
      const previous = current.rows[0];
      if (previous && input.effectiveOn <= previous.effective_on) {
        return "ATTENDANCE_POLICY_DATE_INVALID" as const;
      }
      if (previous) {
        await transaction.query(
          `UPDATE nova.organisation_attendance_policies
           SET effective_until = $2::date - 1
           WHERE id = $1`,
          [previous.id, input.effectiveOn],
        );
      }
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.organisation_attendance_policies (
           organisation_id, effective_on, mode, required_attendance_minutes,
           created_by_person_id
         ) VALUES ($1, $2::date, $3::nova.attendance_policy_mode, $4, $5)
         RETURNING id`,
        [actor.context.organisationId, input.effectiveOn, input.mode,
          input.requiredAttendanceMinutes, actor.context.userId],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("ATTENDANCE_POLICY_CREATE_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.audit_events (
           organisation_id, actor_person_id, action, target_type, target_id, details
         ) VALUES ($1, $2, 'availability.attendance_policy_changed',
           'organisation_attendance_policy', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, id,
          JSON.stringify({ effective_on: input.effectiveOn, mode: input.mode,
          required_attendance_minutes: input.requiredAttendanceMinutes })],
      );
      const people = await transaction.query<{ person_id: string }>(
        `SELECT id AS person_id
         FROM nova.people
         WHERE organisation_id = $1
           AND id <> $2
           AND EXISTS (
             SELECT 1
             FROM nova.person_status_periods statuses
             WHERE statuses.person_id = people.id
               AND statuses.ended_at IS NULL
               AND statuses.status IN ('active', 'notice')
           )`,
        [actor.context.organisationId, actor.context.userId],
      );
      for (const person of people.rows) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: person.person_id,
          eventKey: "availability.attendance_policy_changed",
          title: "Attendance policy changed",
          body: `Your attendance rules change from ${input.effectiveOn}.`,
          aggregateType: "organisation_attendance_policy",
          aggregateId: id,
          deepLink: "/?view=today",
          idempotencyKey: `availability.attendance_policy_changed:${id}:${person.person_id}`,
        });
      }
      return { id, ...input };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ATTENDANCE_POLICY_DATE_INVALID") return json({ error: result }, 409);
    return json({ attendancePolicy: result }, 201);
  } catch (error) {
    if (error instanceof Error && /exclusion|duplicate key|unique/i.test(error.message)) {
      return json({ error: "ATTENDANCE_POLICY_DATE_INVALID" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

type OnboardingResult =
  | "PERMISSION_DENIED"
  | "PERSON_NOT_FOUND"
  | "PERSON_NOT_ONBOARDING"
  | "PERSON_STATUS_UNAVAILABLE"
  | "PERSON_ONBOARDING_ALREADY_CONFIGURED"
  | "ONBOARDING_RELATION_INVALID"
  | "ONBOARDING_START_DATE_IN_FUTURE"
  | string;

async function completeOnboarding(
  context: DatabaseRequestContext,
  input: CompleteOnboardingInput,
): Promise<OnboardingResult> {
  return withDatabaseRequest(context, async (transaction) => {
    const requiredPermissions = [
      "people.edit",
      "people.activate",
      "roles.assign",
    ];
    for (const permission of requiredPermissions) {
      if (!await hasOrganisationPermission(transaction, context.userId, permission)) {
        return "PERMISSION_DENIED";
      }
    }

    const person = await transaction.query<{ id: string }>(
      `SELECT id FROM nova.people WHERE id = $1 FOR UPDATE`,
      [input.personId],
    );
    if (!person.rows[0]) {
      return "PERSON_NOT_FOUND";
    }
    // Take the person lock before reading status in a separate statement. A
    // concurrent activation then waits here and observes the committed active
    // status instead of losing the joined current-status row and being
    // incorrectly reported as a missing person.
    const current = await transaction.query<{ effective_at: Date; status: string }>(
      `SELECT status, effective_at
       FROM nova.person_status_periods
       WHERE person_id = $1 AND ended_at IS NULL
       FOR UPDATE`,
      [input.personId],
    );
    const currentStatus = current.rows[0];
    if (!currentStatus) {
      return "PERSON_STATUS_UNAVAILABLE";
    }
    if (currentStatus.status !== "onboarding") {
      return "PERSON_NOT_ONBOARDING";
    }

    const existing = await transaction.query<{ existing: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM nova.person_office_assignments
        WHERE person_id = $1 AND effective_until IS NULL
        UNION ALL
        SELECT 1 FROM nova.person_department_assignments
        WHERE person_id = $1 AND effective_until IS NULL
        UNION ALL
        SELECT 1 FROM nova.person_role_assignments
        WHERE person_id = $1 AND effective_until IS NULL
        UNION ALL
        SELECT 1 FROM nova.employment_terms
        WHERE person_id = $1 AND employment_ends_on IS NULL
      ) AS existing`,
      [input.personId],
    );
    if (existing.rows[0]?.existing) {
      return "PERSON_ONBOARDING_ALREADY_CONFIGURED";
    }

    const related = await transaction.query<{
      department_valid: boolean;
      manager_valid: boolean;
      office_valid: boolean;
      role_valid: boolean;
    }>(
      `SELECT
        EXISTS (
          SELECT 1 FROM nova.offices
          WHERE id = $1 AND archived_at IS NULL
        ) AS office_valid,
        EXISTS (
          SELECT 1 FROM nova.organisation_departments
          WHERE id = $2 AND archived_at IS NULL
        ) AS department_valid,
        EXISTS (
          SELECT 1 FROM nova.roles
          WHERE id = $3 AND archived_at IS NULL AND is_protected = false
        ) AS role_valid,
        CASE WHEN $4::uuid IS NULL THEN true ELSE EXISTS (
          SELECT 1
          FROM nova.people managers
          JOIN nova.person_status_periods manager_status
            ON manager_status.person_id = managers.id
           AND manager_status.ended_at IS NULL
          WHERE managers.id = $4
            AND manager_status.status IN ('active', 'notice')
        ) END AS manager_valid`,
      [
        input.officeId,
        input.organisationDepartmentId,
        input.roleId,
        input.managerPersonId ?? null,
      ],
    );
    const valid = related.rows[0];
    if (!valid?.office_valid || !valid.department_valid || !valid.role_valid || !valid.manager_valid) {
      return "ONBOARDING_RELATION_INVALID";
    }

    const officeBusinessDate = await transaction.query<{ business_date: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS business_date
       FROM nova.offices
       WHERE id = $1 AND archived_at IS NULL`,
      [input.officeId],
    );
    if (input.employmentStartsOn > (officeBusinessDate.rows[0]?.business_date ?? "")) {
      return "ONBOARDING_START_DATE_IN_FUTURE";
    }

    await transaction.query(
      `INSERT INTO nova.employment_terms (
        person_id, employment_starts_on, designation, manager_person_id
      ) VALUES ($1, $2, $3, $4)`,
      [input.personId, input.employmentStartsOn, input.designation, input.managerPersonId ?? null],
    );
    await transaction.query(
      `INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
       VALUES ($1, $2, $3)`,
      [input.personId, input.officeId, input.employmentStartsOn],
    );
    await transaction.query(
      `INSERT INTO nova.person_department_assignments (
        person_id, organisation_department_id, effective_on
      ) VALUES ($1, $2, $3)`,
      [input.personId, input.organisationDepartmentId, input.employmentStartsOn],
    );
    await transaction.query(
      `INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
       VALUES ($1, $2, $3)`,
      [input.personId, input.roleId, input.employmentStartsOn],
    );

    const transitionAt = new Date(
      Math.max(Date.now(), currentStatus.effective_at.getTime() + 1),
    );
    await transaction.query(
      `UPDATE nova.person_status_periods
       SET ended_at = $2
       WHERE person_id = $1 AND ended_at IS NULL`,
      [input.personId, transitionAt],
    );
    await transaction.query(
      `INSERT INTO nova.person_status_periods (person_id, status, effective_at)
       VALUES ($1, 'active', $2)`,
      [input.personId, transitionAt],
    );
    await transaction.query(
      `INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES ($1, $2, 'people.onboarding.completed', 'person', $3, $4)`,
      [
        context.organisationId,
        context.userId,
        input.personId,
        JSON.stringify({
          employment_starts_on: input.employmentStartsOn,
          organisation_department_id: input.organisationDepartmentId,
          office_id: input.officeId,
          role_id: input.roleId,
        }),
      ],
    );
    await enqueueNotification(transaction, {
      organisationId: context.organisationId,
      recipientPersonId: input.personId,
      eventKey: "people.onboarded",
      title: "Onboarding complete",
      body: "Your NOVA workspace access is ready.",
      aggregateType: "person",
      aggregateId: input.personId,
      deepLink: "/?view=today",
      idempotencyKey: `people.onboarded:${input.personId}:${transitionAt.toISOString()}`,
    });
    return input.personId;
  });
}

export async function completePersonOnboarding(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) {
    return actor.response;
  }
  const input = completeOnboardingInput(await requestBody(request));
  if (!input) {
    return json({ error: "PERSON_ONBOARDING_INPUT_INVALID" }, 400);
  }

  try {
    const result = await completeOnboarding(actor.context, input);
    if (result === "PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    if (result === "PERSON_NOT_FOUND") {
      return json({ error: result }, 404);
    }
    if (
      result === "PERSON_NOT_ONBOARDING" ||
      result === "PERSON_STATUS_UNAVAILABLE" ||
      result === "PERSON_ONBOARDING_ALREADY_CONFIGURED" ||
      result === "ONBOARDING_RELATION_INVALID" ||
      result === "ONBOARDING_START_DATE_IN_FUTURE"
    ) {
      return json({ error: result }, 409);
    }
    return json({ personId: result, status: "active" }, 201);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
