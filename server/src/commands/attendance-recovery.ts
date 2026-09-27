import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { timestampInput } from "../timestamp-input.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

async function normalActor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

async function canRecover(
  transaction: PoolClient,
  actorId: string,
  targetPersonId: string,
  effectiveDate: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= $3::date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= $3::date)
         AND roles.archived_at IS NULL
         AND grants.permission_key = 'attendance.recover'
         AND (
           grants.scope = 'organisation'
           OR (grants.scope = 'own_record' AND $1 = $2)
           OR (grants.scope = 'office' AND EXISTS (
             SELECT 1 FROM nova.person_office_assignments offices
             WHERE offices.person_id = $2 AND offices.office_id = grants.office_id
               AND offices.effective_on <= $3::date
               AND (offices.effective_until IS NULL OR offices.effective_until >= $3::date)
           ))
           OR (grants.scope = 'organisation_department' AND EXISTS (
             SELECT 1 FROM nova.person_department_assignments departments
             WHERE departments.person_id = $2
               AND departments.organisation_department_id = grants.organisation_department_id
               AND departments.effective_on <= $3::date
               AND (departments.effective_until IS NULL OR departments.effective_until >= $3::date)
           ))
         )
     ) AS permitted`,
    [actorId, targetPersonId, effectiveDate],
  );
  return result.rows[0]?.permitted === true;
}

export async function recoverAttendance(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const personId = typeof input.personId === "string" && uuidPattern.test(input.personId) ? input.personId : undefined;
  const businessDate = input.businessDate;
  const mode = input.mode === "office" || input.mode === "wfh" ? input.mode : undefined;
  const checkedInAt = timestampInput(input.checkedInAt);
  const checkedOutAt = timestampInput(input.checkedOutAt);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!personId || !validDate(businessDate) || !mode || !checkedInAt || checkedOutAt === undefined ||
    !reason || reason.length > 2000) {
    return json({ error: "ATTENDANCE_RECOVERY_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const window = await transaction.query<{ today: string }>("SELECT nova.person_business_date($1)::text AS today", [personId]);
      const today = window.rows[0]?.today;
      if (!today) throw new Error("DATABASE_DATE_RESULT_MISSING");
      const dateDelta = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${businessDate}T00:00:00Z`)) / 86_400_000;
      if (dateDelta < 0 || dateDelta > 31) return "ATTENDANCE_RECOVERY_WINDOW_INVALID" as const;
      const timeInput = await transaction.query<{ valid: boolean }>(
        `WITH db_clock AS (SELECT clock_timestamp() AS at)
         SELECT $1::timestamptz <= db_clock.at
           AND ($2::timestamptz IS NULL OR (
             $2::timestamptz > $1::timestamptz AND $2::timestamptz <= db_clock.at
           )) AS valid
         FROM db_clock`,
        [checkedInAt, checkedOutAt],
      );
      if (timeInput.rows[0]?.valid !== true) return "ATTENDANCE_RECOVERY_INPUT_INVALID" as const;
      const person = await transaction.query<{ id: string }>(
        "SELECT id FROM nova.people WHERE id = $1 AND organisation_id = $2",
        [personId, actor.context.organisationId],
      );
      if (!person.rows[0]) return "PERSON_NOT_FOUND" as const;
      if (!await canRecover(transaction, actor.context.userId, personId, businessDate)) return "PERMISSION_DENIED" as const;

      const locked = await transaction.query<{
        id: string; office_id: string; mode: string; checked_in_at: string; checked_out_at: string | null;
        mode_changed_at: string | null; check_in_latitude: string | null; check_in_longitude: string | null;
        check_in_accuracy_meters: string | null; check_in_distance_meters: string | null;
      }>(
        `SELECT id, office_id, mode, checked_in_at::text, checked_out_at::text, mode_changed_at::text,
                check_in_latitude, check_in_longitude, check_in_accuracy_meters, check_in_distance_meters
         FROM nova.attendance_days
         WHERE person_id = $1 AND business_date = $2::date
         FOR UPDATE`,
        [personId, businessDate],
      );
      const existing = locked.rows[0];
      let attendanceId = existing?.id;
      let officeId = existing?.office_id;
      const before = existing ? {
        mode: existing.mode, officeId: existing.office_id, checkedInAt: existing.checked_in_at,
        checkedOutAt: existing.checked_out_at, modeChangedAt: existing.mode_changed_at,
        checkInLatitude: existing.check_in_latitude, checkInLongitude: existing.check_in_longitude,
        checkInAccuracyMeters: existing.check_in_accuracy_meters, checkInDistanceMeters: existing.check_in_distance_meters,
      } : null;
      if (!officeId) {
        const office = await transaction.query<{ id: string }>(
          `SELECT offices.id FROM nova.person_office_assignments assignments
           JOIN nova.offices offices ON offices.id = assignments.office_id
           WHERE assignments.person_id = $1 AND assignments.effective_on <= $2::date
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
             AND offices.organisation_id = $3 AND offices.archived_at IS NULL
           ORDER BY assignments.effective_on DESC LIMIT 1`,
          [personId, businessDate, actor.context.organisationId],
        );
        officeId = office.rows[0]?.id;
      }
      if (!officeId) return "OFFICE_ASSIGNMENT_REQUIRED" as const;
      const boundary = await transaction.query<{ valid: boolean; timezone: string }>(
        `SELECT offices.timezone,
                $3::timestamptz >= ($2::date::timestamp AT TIME ZONE offices.timezone)
                  AND $3::timestamptz < (($2::date + 1)::timestamp AT TIME ZONE offices.timezone)
                  AND ($4::timestamptz IS NULL OR (
                    $4::timestamptz > $3::timestamptz
                    AND $4::timestamptz <= (($2::date + 1)::timestamp AT TIME ZONE offices.timezone)
                  )) AS valid
         FROM nova.offices offices
         WHERE offices.id = $1 AND offices.organisation_id = $5 AND offices.archived_at IS NULL`,
        [officeId, businessDate, checkedInAt, checkedOutAt, actor.context.organisationId],
      );
      if (boundary.rows[0]?.valid !== true) {
        return "ATTENDANCE_RECOVERY_BOUNDARY_INVALID" as const;
      }
      const officeTimezone = boundary.rows[0].timezone;
      if (existing) {
        await transaction.query(
          `UPDATE nova.attendance_days
           SET mode = $2::nova.attendance_mode,
               checked_in_at = $3, checked_out_at = $4,
               office_timezone_snapshot = $5,
               closure_reason = CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE 'MANUAL_RECOVERY' END,
               mode_changed_at = CASE WHEN mode = $2::nova.attendance_mode THEN mode_changed_at ELSE clock_timestamp() END
           WHERE id = $1`,
          [existing.id, mode, checkedInAt, checkedOutAt, officeTimezone],
        );
      } else {
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.attendance_days (
             organisation_id, person_id, office_id, office_timezone_snapshot,
             business_date, mode, checked_in_at, checked_out_at, closure_reason
           ) VALUES ($1, $2, $3, $4, $5::date, $6::nova.attendance_mode, $7, $8,
             CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE 'MANUAL_RECOVERY' END) RETURNING id`,
          [actor.context.organisationId, personId, officeId, officeTimezone,
            businessDate, mode, checkedInAt, checkedOutAt],
        );
        attendanceId = created.rows[0]?.id;
      }
      if (!attendanceId) throw new Error("ATTENDANCE_RECOVERY_RESULT_MISSING");
      const after = { mode, officeId, checkedInAt, checkedOutAt, source: "manual_recovery" };
      const correction = await transaction.query<{ id: string }>(
        `INSERT INTO nova.attendance_corrections (
           organisation_id, person_id, attendance_day_id, business_date,
           before_state, after_state, reason, corrected_by_person_id
         ) VALUES ($1, $2, $3, $4::date, $5::jsonb, $6::jsonb, $7, $8) RETURNING id`,
        [actor.context.organisationId, personId, attendanceId, businessDate,
          JSON.stringify(before), JSON.stringify(after), reason, actor.context.userId],
      );
      const correctionId = correction.rows[0]?.id;
      if (!correctionId) throw new Error("ATTENDANCE_CORRECTION_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'attendance.recovered', 'attendance_correction', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, correctionId,
          JSON.stringify({ person_id: personId, business_date: businessDate, attendance_day_id: attendanceId })],
      );
      if (personId !== actor.context.userId) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: personId,
          eventKey: "attendance.recovered",
          title: "Attendance record updated",
          body: `Your attendance for ${businessDate} was updated by an authorised administrator.`,
          aggregateType: "attendance_correction",
          aggregateId: correctionId,
          deepLink: "/?view=today&attendance=" + attendanceId,
          idempotencyKey: `attendance.recovered:${correctionId}`,
        });
      }
      return { correctionId, attendanceId, personId, businessDate, mode, checkedInAt, checkedOutAt };
    });
    if (result === "ATTENDANCE_RECOVERY_INPUT_INVALID") return json({ error: result }, 400);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "PERSON_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result, 201);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
