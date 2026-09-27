import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { approvedWfhOnDate } from "./wfh-requests.js";
import { checkOutWfhProvisionalEvidence } from "./wfh-provisional.js";
import { enqueueNotification } from "./notifications.js";
import { lockAvailabilityDates } from "./availability-lock.js";

type AttendanceMode = "office" | "wfh";

type AvailabilityContext = Readonly<{
  attendanceMode: "hour_based" | "scheduled";
  requiredAttendanceMinutes: number;
  businessDate: string;
  calendarId: string | null;
  isHoliday: boolean;
  isWorkingDay: boolean;
  officeId: string;
  officeLatitude: number | null;
  officeLongitude: number | null;
  geofenceRadiusMeters: number;
  officeName: string;
  shiftId: string | null;
  timezone: string;
  wfhAllowed: boolean;
}>;

type AttendanceInput = Readonly<{
  accuracyMeters?: number;
  latitude?: number;
  longitude?: number;
  mode: AttendanceMode;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function attendanceInput(body: unknown): AttendanceInput | undefined {
  if (typeof body !== "object" || body === null) return { mode: "office" };
  const candidate = body as Record<string, unknown>;
  const mode = candidate.mode === undefined ? "office" : candidate.mode;
  if (mode !== "office" && mode !== "wfh") return undefined;
  const values = [candidate.latitude, candidate.longitude, candidate.accuracyMeters];
  if (values.every((value) => value === undefined || value === null)) return { mode };
  if (
    typeof candidate.latitude !== "number" || !Number.isFinite(candidate.latitude) || candidate.latitude < -90 || candidate.latitude > 90 ||
    typeof candidate.longitude !== "number" || !Number.isFinite(candidate.longitude) || candidate.longitude < -180 || candidate.longitude > 180 ||
    typeof candidate.accuracyMeters !== "number" || !Number.isFinite(candidate.accuracyMeters) || candidate.accuracyMeters < 0 || candidate.accuracyMeters > 10000
  ) return undefined;
  return Object.freeze({
    mode,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    accuracyMeters: candidate.accuracyMeters,
  });
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
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function hasSelfPermission(
  transaction: PoolClient,
  actorId: string,
  permissionKey: string,
  effectiveDate?: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM nova.person_role_assignments assignments
      JOIN nova.roles roles ON roles.id = assignments.role_id
      JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
      WHERE assignments.person_id = $1
        AND assignments.effective_on <= COALESCE($3::date, nova.person_business_date($1))
        AND (assignments.effective_until IS NULL OR assignments.effective_until >= COALESCE($3::date, nova.person_business_date($1)))
        AND roles.archived_at IS NULL
        AND grants.permission_key = $2
        AND (
          grants.scope IN ('organisation', 'own_record')
          OR (
            grants.scope = 'office'
            AND EXISTS (
              SELECT 1
              FROM nova.person_office_assignments office_assignments
              WHERE office_assignments.person_id = $1
                AND office_assignments.office_id = grants.office_id
                AND office_assignments.effective_on <= COALESCE($3::date, nova.person_business_date($1))
                AND (
                  office_assignments.effective_until IS NULL
                  OR office_assignments.effective_until >= COALESCE($3::date, nova.person_business_date($1))
                )
            )
          )
          OR (
            grants.scope = 'organisation_department'
            AND EXISTS (
              SELECT 1
              FROM nova.person_department_assignments department_assignments
              WHERE department_assignments.person_id = $1
                AND department_assignments.organisation_department_id = grants.organisation_department_id
                AND department_assignments.effective_on <= COALESCE($3::date, nova.person_business_date($1))
                AND (
                  department_assignments.effective_until IS NULL
                  OR department_assignments.effective_until >= COALESCE($3::date, nova.person_business_date($1))
                )
            )
          )
        )
    ) AS permitted`,
    [actorId, permissionKey, effectiveDate ?? null],
  );
  return result.rows[0]?.permitted === true;
}

async function currentAvailability(
  transaction: PoolClient,
  context: DatabaseRequestContext,
): Promise<AvailabilityContext | "OFFICE_ASSIGNMENT_REQUIRED"> {
  const office = await transaction.query<{
    office_id: string;
    office_name: string;
    timezone: string;
    business_date: string;
    latitude: string | null;
    longitude: string | null;
    geofence_radius_meters: number;
  }>(
    `SELECT offices.id AS office_id,
            offices.name AS office_name,
            offices.timezone,
            (now() AT TIME ZONE offices.timezone)::date::text AS business_date,
            offices.latitude, offices.longitude,
            offices.attendance_geofence_radius_meters AS geofence_radius_meters
     FROM nova.person_office_assignments assignments
     JOIN nova.offices offices ON offices.id = assignments.office_id
     WHERE assignments.person_id = $1
       AND assignments.effective_on <= (now() AT TIME ZONE offices.timezone)::date
       AND (
         assignments.effective_until IS NULL
         OR assignments.effective_until >= (now() AT TIME ZONE offices.timezone)::date
       )
       AND offices.archived_at IS NULL
     ORDER BY assignments.effective_on DESC
     LIMIT 1`,
    [context.userId],
  );
  const currentOffice = office.rows[0];
  if (!currentOffice) return "OFFICE_ASSIGNMENT_REQUIRED";

  const calendar = await transaction.query<{
    calendar_id: string;
    is_working: boolean;
    shift_id: string | null;
  }>(
    `SELECT calendars.id AS calendar_id,
            rules.is_working,
            shifts.id AS shift_id
     FROM nova.office_calendar_assignments assignments
     JOIN nova.working_calendars calendars ON calendars.id = assignments.calendar_id
       AND calendars.archived_at IS NULL
     LEFT JOIN nova.working_calendar_rules rules
       ON rules.calendar_id = calendars.id
      AND rules.weekday = EXTRACT(DOW FROM $2::date)::smallint
      AND rules.ordinal IN (0, ((EXTRACT(DAY FROM $2::date)::integer - 1) / 7) + 1)
     LEFT JOIN nova.shifts shifts
       ON shifts.id = rules.shift_id AND shifts.archived_at IS NULL
     WHERE assignments.office_id = $1
       AND assignments.effective_on <= $2::date
       AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
     ORDER BY assignments.effective_on DESC, rules.ordinal DESC
     LIMIT 1`,
    [currentOffice.office_id, currentOffice.business_date],
  );
  const rule = calendar.rows[0];
  const holiday = await transaction.query(
    `SELECT 1 FROM nova.office_holidays
     WHERE office_id = $1 AND holiday_date = $2::date`,
    [currentOffice.office_id, currentOffice.business_date],
  );
  const rolePolicy = await transaction.query<{ wfh_allowed: boolean }>(
    `SELECT policies.wfh_allowed
     FROM nova.person_role_assignments assignments
     JOIN nova.roles roles ON roles.id = assignments.role_id
     JOIN nova.role_operational_policies policies ON policies.role_id = roles.id
     WHERE assignments.person_id = $1
       AND assignments.effective_on <= $2::date
       AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
       AND roles.archived_at IS NULL
     ORDER BY assignments.effective_on DESC
     LIMIT 1`,
    [context.userId, currentOffice.business_date],
  );
  const attendancePolicy = await transaction.query<{
    mode: "hour_based" | "scheduled";
    required_attendance_minutes: number;
  }>(
    `SELECT mode, required_attendance_minutes
     FROM nova.organisation_attendance_policies
     WHERE organisation_id = $1
       AND effective_on <= $2::date
       AND (effective_until IS NULL OR effective_until >= $2::date)
     ORDER BY effective_on DESC
     LIMIT 1`,
    [context.organisationId, currentOffice.business_date],
  );
  const wfhOverride = await transaction.query<{ allowed: boolean }>(
    `SELECT overrides.allowed
     FROM nova.wfh_policy_overrides overrides
     WHERE overrides.organisation_id = $1
       AND overrides.effective_on <= $3::date
       AND (overrides.effective_until IS NULL OR overrides.effective_until >= $3::date)
       AND (
         (overrides.target_type = 'person' AND overrides.target_id = $2)
         OR (
           overrides.target_type = 'organisation_department'
           AND EXISTS (
             SELECT 1 FROM nova.person_department_assignments departments
             WHERE departments.person_id = $2
               AND departments.organisation_department_id = overrides.target_id
               AND departments.effective_on <= $3::date
               AND (departments.effective_until IS NULL OR departments.effective_until >= $3::date)
           )
         )
         OR (overrides.target_type = 'office' AND overrides.target_id = $4)
       )
     ORDER BY CASE overrides.target_type
       WHEN 'person' THEN 1
       WHEN 'organisation_department' THEN 2
       ELSE 3
     END
     LIMIT 1`,
    [context.organisationId, context.userId, currentOffice.business_date, currentOffice.office_id],
  );

  return {
    attendanceMode: attendancePolicy.rows[0]?.mode ?? "hour_based",
    requiredAttendanceMinutes: attendancePolicy.rows[0]?.required_attendance_minutes ?? 480,
    businessDate: currentOffice.business_date,
    calendarId: rule?.calendar_id ?? null,
    isHoliday: holiday.rows.length > 0,
    isWorkingDay: rule?.is_working === true,
    officeId: currentOffice.office_id,
    officeLatitude: currentOffice.latitude === null ? null : Number(currentOffice.latitude),
    officeLongitude: currentOffice.longitude === null ? null : Number(currentOffice.longitude),
    geofenceRadiusMeters: currentOffice.geofence_radius_meters,
    officeName: currentOffice.office_name,
    shiftId: rule?.shift_id ?? null,
    timezone: currentOffice.timezone,
    wfhAllowed: wfhOverride.rows[0]?.allowed ?? (rolePolicy.rows[0]?.wfh_allowed === true),
  };
}

export function distanceMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(targetLatitude - latitude);
  const normalizedLongitudeDifference = ((targetLongitude - longitude + 540) % 360) - 180;
  const longitudeDelta = radians(normalizedLongitudeDifference);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function verifyOfficeLocation(
  availability: AvailabilityContext,
  input: AttendanceInput,
): { ok: true; distanceMeters: number } | { ok: false; error: string } {
  if (availability.officeLatitude === null || availability.officeLongitude === null) {
    return { ok: false, error: "ATTENDANCE_GEOFENCE_NOT_CONFIGURED" };
  }
  if (input.latitude === undefined || input.longitude === undefined || input.accuracyMeters === undefined) {
    return { ok: false, error: "ATTENDANCE_LOCATION_REQUIRED" };
  }
  if (input.accuracyMeters > availability.geofenceRadiusMeters) {
    return { ok: false, error: "ATTENDANCE_LOCATION_ACCURACY_TOO_LOW" };
  }
  const distance = distanceMeters(
    input.latitude,
    input.longitude,
    availability.officeLatitude,
    availability.officeLongitude,
  );
  return distance <= availability.geofenceRadiusMeters
    ? { ok: true, distanceMeters: Number(distance.toFixed(2)) }
    : { ok: false, error: "ATTENDANCE_OUTSIDE_GEOFENCE" };
}

function availabilityError(availability: AvailabilityContext): string | undefined {
  if (!availability.calendarId) return "ATTENDANCE_CALENDAR_REQUIRED";
  if (availability.isHoliday) return "ATTENDANCE_HOLIDAY";
  if (!availability.isWorkingDay) return "ATTENDANCE_NON_WORKING_DAY";
  if (availability.attendanceMode === "scheduled" && !availability.shiftId) {
    return "ATTENDANCE_SCHEDULE_REQUIRED";
  }
  return undefined;
}

async function approvedLeaveOnDate(
  transaction: PoolClient,
  personId: string,
  businessDate: string,
): Promise<boolean> {
  const result = await transaction.query(
    `SELECT 1
     FROM nova.leave_request_days days
     JOIN nova.leave_requests requests ON requests.id = days.request_id
     WHERE days.person_id = $1
       AND days.business_date = $2::date
       AND requests.status = 'approved'
     LIMIT 1`,
    [personId, businessDate],
  );
  return result.rows.length > 0;
}

async function lockOperationalPerson(transaction: PoolClient, personId: string): Promise<boolean> {
  const result = await transaction.query<{ status: string }>(
    `SELECT status FROM nova.person_status_periods
     WHERE person_id = $1 AND ended_at IS NULL
     FOR KEY SHARE`,
    [personId],
  );
  return ["active", "notice"].includes(result.rows[0]?.status ?? "");
}

export async function readAttendanceToday(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const availability = await currentAvailability(transaction, actor.context);
      if (availability === "OFFICE_ASSIGNMENT_REQUIRED") return availability;
      if (!await hasSelfPermission(
        transaction,
        actor.context.userId,
        "attendance.view",
        availability.businessDate,
      )) return "PERMISSION_DENIED" as const;
      const attendance = await transaction.query<{
        id: string; mode: AttendanceMode; checked_in_at: Date;
        checked_out_at: Date | null; mode_changed_at: Date | null; closure_reason: string | null; boundary_at: Date;
      }>(
        `SELECT attendance.id, attendance.mode, attendance.checked_in_at, attendance.checked_out_at,
                attendance.mode_changed_at, attendance.closure_reason,
                ((attendance.business_date + 1)::timestamp
                  AT TIME ZONE COALESCE(attendance.office_timezone_snapshot, offices.timezone)) AS boundary_at
         FROM nova.attendance_days attendance
         JOIN nova.offices offices ON offices.id = attendance.office_id
         WHERE person_id = $1 AND business_date = $2::date`,
        [actor.context.userId, availability.businessDate],
      );
      const onApprovedLeave = await approvedLeaveOnDate(
        transaction,
        actor.context.userId,
        availability.businessDate,
      );
      const wfhApproved = await approvedWfhOnDate(
        transaction,
        actor.context.userId,
        availability.businessDate,
      );
      const wfhPending = await transaction.query(
        `SELECT 1 FROM nova.wfh_requests
         WHERE person_id = $1 AND status = 'pending'
           AND start_date <= $2::date AND end_date >= $2::date
         LIMIT 1`,
        [actor.context.userId, availability.businessDate],
      );
      const provisional = await transaction.query<{
        id: string; status: string; checked_in_at: Date; checked_out_at: Date | null;
        resolved_at: Date | null; resolution_reason: string | null;
      }>(
        `SELECT evidence.id, evidence.status, evidence.checked_in_at, evidence.checked_out_at,
                evidence.resolved_at, evidence.resolution_reason
         FROM nova.wfh_provisional_attendance evidence
         WHERE evidence.person_id = $1 AND evidence.business_date = $2::date
         ORDER BY evidence.created_at DESC
         LIMIT 1`,
        [actor.context.userId, availability.businessDate],
      );
      const row = attendance.rows[0];
      const durationMinutes = row
        ? Math.max(0, Math.floor(((row.checked_out_at
          ? new Date(row.checked_out_at)
          : (() => {
            const now = new Date();
            const boundary = new Date(row.boundary_at);
            return boundary < now ? boundary : now;
          })()).getTime() - new Date(row.checked_in_at).getTime()) / 60_000))
        : 0;
      return {
        availability,
        onApprovedLeave,
        wfhApproved,
        wfhPending: wfhPending.rows.length > 0,
        provisionalAttendance: provisional.rows[0] ? {
          id: provisional.rows[0].id,
          status: provisional.rows[0].status,
          checkedInAt: provisional.rows[0].checked_in_at,
          checkedOutAt: provisional.rows[0].checked_out_at,
          resolvedAt: provisional.rows[0].resolved_at,
          resolutionReason: provisional.rows[0].resolution_reason,
          creditable: provisional.rows[0].status === "promoted",
        } : null,
        attendanceSummary: {
          durationMinutes,
          requiredMinutes: availability.requiredAttendanceMinutes,
          requirementSatisfied: availability.attendanceMode === "hour_based" && durationMinutes >= availability.requiredAttendanceMinutes,
        },
        attendance: row ? {
          id: row.id,
          mode: row.mode,
          checkedInAt: row.checked_in_at,
          checkedOutAt: row.checked_out_at,
          modeChangedAt: row.mode_changed_at,
          closureReason: row.closure_reason,
        } : null,
      };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "OFFICE_ASSIGNMENT_REQUIRED") return json({ error: result }, 409);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function checkIn(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = attendanceInput(await requestBody(request));
  if (!input) return json({ error: "ATTENDANCE_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const availability = await currentAvailability(transaction, actor.context);
      if (availability === "OFFICE_ASSIGNMENT_REQUIRED") return availability;
      await lockAvailabilityDates(transaction, actor.context.userId, availability.businessDate, availability.businessDate);
      if (!await lockOperationalPerson(transaction, actor.context.userId)) return "ACCOUNT_NOT_OPERATIONAL" as const;
      if (!await hasSelfPermission(
        transaction,
        actor.context.userId,
        "attendance.check_in",
        availability.businessDate,
      )) return "PERMISSION_DENIED" as const;
      const ruleError = availabilityError(availability);
      if (ruleError) return ruleError;
      if (await approvedLeaveOnDate(transaction, actor.context.userId, availability.businessDate)) {
        return "ATTENDANCE_APPROVED_LEAVE" as const;
      }
      if (input.mode === "wfh" && !availability.wfhAllowed) return "WFH_NOT_ALLOWED" as const;
      if (input.mode === "office") {
        const pendingWfh = await transaction.query(
          `SELECT 1 FROM nova.wfh_requests
           WHERE person_id = $1 AND status = 'pending'
             AND start_date <= $2::date AND end_date >= $2::date
           LIMIT 1 FOR UPDATE`,
          [actor.context.userId, availability.businessDate],
        );
        if (pendingWfh.rows[0]) return "WFH_REQUEST_CANCEL_BEFORE_OFFICE_CHECK_IN" as const;
      }
      const location = input.mode === "office"
        ? verifyOfficeLocation(availability, input)
        : { ok: true as const, distanceMeters: null };
      if (!location.ok) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: actor.context.userId,
          eventKey: "attendance.location_rejected",
          title: "Attendance location rejected",
          body: `Office attendance was not recorded: ${location.error}.`,
          aggregateType: "attendance_day",
          deepLink: "/?view=today",
          idempotencyKey: `attendance.location_rejected:${actor.context.userId}:${availability.businessDate}:${Math.floor(Date.now() / 60000)}`,
        });
        return location.error;
      }
      const approvedWfh = input.mode === "wfh" && await approvedWfhOnDate(
        transaction, actor.context.userId, availability.businessDate,
      );
      if (input.mode === "wfh" && !approvedWfh) {
        const pendingRequest = await transaction.query<{ id: string }>(
          `SELECT id FROM nova.wfh_requests
           WHERE person_id = $1 AND status = 'pending'
             AND start_date <= $2::date AND end_date >= $2::date
           LIMIT 1 FOR UPDATE`,
          [actor.context.userId, availability.businessDate],
        );
        const requestId = pendingRequest.rows[0]?.id;
        if (!requestId) return "WFH_APPROVAL_REQUIRED" as const;
        const existingAttendance = await transaction.query(
          `SELECT 1 FROM nova.attendance_days
           WHERE person_id = $1 AND business_date = $2::date
           LIMIT 1`,
          [actor.context.userId, availability.businessDate],
        );
        if (existingAttendance.rows[0]) return "ATTENDANCE_ALREADY_EXISTS" as const;
        const evidence = await transaction.query<{ id: string; checked_in_at: Date }>(
          `INSERT INTO nova.wfh_provisional_attendance (
             organisation_id, request_id, person_id, office_id,
             office_timezone_snapshot, business_date
           ) VALUES ($1, $2, $3, $4, $5, $6::date)
           RETURNING id, checked_in_at`,
          [actor.context.organisationId, requestId, actor.context.userId,
            availability.officeId, availability.timezone, availability.businessDate],
        );
        const provisional = evidence.rows[0];
        if (!provisional) throw new Error("WFH_PROVISIONAL_CHECK_IN_MISSING");
        await transaction.query(
          `INSERT INTO nova.audit_events (
            organisation_id, actor_person_id, action, target_type, target_id, details
          ) VALUES ($1, $2, 'attendance.provisional_checked_in',
            'wfh_provisional_attendance', $3, $4)`,
          [actor.context.organisationId, actor.context.userId, provisional.id,
            JSON.stringify({ request_id: requestId, business_date: availability.businessDate,
              creditable: false })],
        );
        return {
          provisionalAttendanceId: provisional.id,
          businessDate: availability.businessDate,
          mode: "wfh" as const,
          checkedInAt: provisional.checked_in_at,
          provisional: true as const,
          creditable: false as const,
        };
      }
      const attendance = await transaction.query<{ id: string; checked_in_at: Date }>(
        `INSERT INTO nova.attendance_days (
          organisation_id, person_id, office_id, office_timezone_snapshot, business_date, mode, checked_in_at,
          check_in_latitude, check_in_longitude, check_in_accuracy_meters, check_in_distance_meters
        ) VALUES ($1, $2, $3, $4, $5::date, $6, clock_timestamp(), $7, $8, $9, $10)
        RETURNING id, checked_in_at`,
        [actor.context.organisationId, actor.context.userId, availability.officeId,
          availability.timezone, availability.businessDate, input.mode,
          input.mode === "office" ? input.latitude ?? null : null,
          input.mode === "office" ? input.longitude ?? null : null,
          input.mode === "office" ? input.accuracyMeters ?? null : null,
          location.distanceMeters],
      );
      const row = attendance.rows[0];
      if (!row) throw new Error("ATTENDANCE_CREATE_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'attendance.checked_in', 'attendance_day', $3, $4)`,
        [
          actor.context.organisationId,
          actor.context.userId,
          row.id,
          JSON.stringify({ business_date: availability.businessDate, mode: input.mode,
            distance_meters: location.distanceMeters }),
        ],
      );
      return { attendanceId: row.id, businessDate: availability.businessDate, mode: input.mode, checkedInAt: row.checked_in_at };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return json({ error: "ATTENDANCE_ALREADY_EXISTS" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function checkOut(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const availability = await currentAvailability(transaction, actor.context);
      if (availability === "OFFICE_ASSIGNMENT_REQUIRED") return availability;
      await lockAvailabilityDates(transaction, actor.context.userId, availability.businessDate, availability.businessDate);
      if (!await lockOperationalPerson(transaction, actor.context.userId)) return "ACCOUNT_NOT_OPERATIONAL" as const;
      if (!await hasSelfPermission(
        transaction,
        actor.context.userId,
        "attendance.check_out",
        availability.businessDate,
      )) return "PERMISSION_DENIED" as const;
      const attendance = await transaction.query<{
        id: string; business_date: string; checked_in_at: Date; checked_out_at: Date | null;
      }>(
        `SELECT id, business_date::text, checked_in_at, checked_out_at
         FROM nova.attendance_days
         WHERE person_id = $1 AND checked_out_at IS NULL
         ORDER BY checked_in_at DESC
         LIMIT 1
         FOR UPDATE`,
        [actor.context.userId],
      );
      const row = attendance.rows[0];
      if (!row) {
        const provisional = await transaction.query<{ id: string }>(
          `SELECT id FROM nova.wfh_provisional_attendance
           WHERE person_id = $1 AND status = 'pending' AND checked_out_at IS NULL
           ORDER BY business_date DESC, checked_in_at DESC
           LIMIT 1 FOR UPDATE`,
          [actor.context.userId],
        );
        const provisionalId = provisional.rows[0]?.id;
        if (!provisionalId) return "ATTENDANCE_NOT_FOUND" as const;
        const closed = await checkOutWfhProvisionalEvidence(transaction, provisionalId);
        if (!closed.checkedOutAt) throw new Error("WFH_PROVISIONAL_CHECKOUT_MISSING");
        await transaction.query(
          `INSERT INTO nova.audit_events (
            organisation_id, actor_person_id, action, target_type, target_id, details
          ) VALUES ($1, $2, 'attendance.provisional_checked_out',
            'wfh_provisional_attendance', $3, '{}'::jsonb)`,
          [actor.context.organisationId, actor.context.userId, provisionalId],
        );
        return {
          provisionalAttendanceId: provisionalId,
          checkedOutAt: closed.checkedOutAt,
          provisional: true as const,
          creditable: false as const,
        };
      }
      if (row.checked_out_at) return "ATTENDANCE_ALREADY_CLOSED" as const;
      const updated = await transaction.query<{ checked_out_at: Date }>(
        `UPDATE nova.attendance_days
         SET checked_out_at = clock_timestamp(), closure_reason = 'USER_CHECKOUT'
         WHERE id = $1
         RETURNING checked_out_at`,
        [row.id],
      );
      const checkedOutAt = updated.rows[0]?.checked_out_at;
      if (!checkedOutAt) throw new Error("ATTENDANCE_CHECKOUT_RESULT_MISSING");
      const required = await transaction.query<{ required: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM nova.person_role_assignments assignments
           JOIN nova.role_operational_policies policies ON policies.role_id = assignments.role_id
           WHERE assignments.person_id = $1
             AND assignments.effective_on <= $2::date
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
             AND policies.attendance_required
         ) AS required`,
         [actor.context.userId, row.business_date],
      );
      if (required.rows[0]?.required === true) {
        await transaction.query(
          `SELECT nova.close_person_work_sessions($1, $2, 'ATTENDANCE_CHECKOUT')`,
          [actor.context.userId, checkedOutAt],
        );
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'attendance.checked_out', 'attendance_day', $3, '{}'::jsonb)`,
        [actor.context.organisationId, actor.context.userId, row.id],
      );
      return { attendanceId: row.id, checkedOutAt };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function changeAttendanceMode(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = attendanceInput(await requestBody(request));
  if (!input) return json({ error: "ATTENDANCE_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const availability = await currentAvailability(transaction, actor.context);
      if (availability === "OFFICE_ASSIGNMENT_REQUIRED") return availability;
      await lockAvailabilityDates(transaction, actor.context.userId, availability.businessDate, availability.businessDate);
      if (!await lockOperationalPerson(transaction, actor.context.userId)) return "ACCOUNT_NOT_OPERATIONAL" as const;
      if (!await hasSelfPermission(
        transaction,
        actor.context.userId,
        "attendance.change_mode",
        availability.businessDate,
      )) return "PERMISSION_DENIED" as const;
      const row = await transaction.query<{
        id: string; mode: AttendanceMode; checked_out_at: Date | null;
      }>(
        `SELECT id, mode, checked_out_at
         FROM nova.attendance_days
         WHERE person_id = $1 AND business_date = $2::date
         FOR UPDATE`,
        [actor.context.userId, availability.businessDate],
      );
      const attendance = row.rows[0];
      if (!attendance) return "ATTENDANCE_NOT_FOUND" as const;
      if (attendance.checked_out_at) return "ATTENDANCE_ALREADY_CLOSED" as const;
      if (await approvedLeaveOnDate(transaction, actor.context.userId, availability.businessDate)) {
        return "ATTENDANCE_APPROVED_LEAVE" as const;
      }
      if (input.mode === "wfh" && !availability.wfhAllowed) return "WFH_NOT_ALLOWED" as const;
      if (input.mode === "wfh" && !await approvedWfhOnDate(
        transaction, actor.context.userId, availability.businessDate,
      )) return "WFH_APPROVAL_REQUIRED" as const;
      const location = input.mode === "office"
        ? verifyOfficeLocation(availability, input)
        : { ok: true as const, distanceMeters: null };
      if (!location.ok) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: actor.context.userId,
          eventKey: "attendance.location_rejected",
          title: "Attendance location rejected",
          body: `The attendance mode change was not recorded: ${location.error}.`,
          aggregateType: "attendance_day",
          aggregateId: attendance.id,
          deepLink: "/?view=today",
          idempotencyKey: `attendance.location_rejected:${attendance.id}:${Math.floor(Date.now() / 60000)}`,
        });
        return location.error;
      }
      if (attendance.mode === input.mode) return { attendanceId: attendance.id, mode: input.mode };
      await transaction.query(
        `UPDATE nova.attendance_days
         SET mode = $2, mode_changed_at = clock_timestamp()
         WHERE id = $1`,
        [attendance.id, input.mode],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'attendance.mode_changed', 'attendance_day', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, attendance.id,
          JSON.stringify({ mode: input.mode, distance_meters: location.distanceMeters })],
      );
      return { attendanceId: attendance.id, mode: input.mode };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
