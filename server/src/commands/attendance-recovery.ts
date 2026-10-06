import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { timestampInput } from "../timestamp-input.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type AttendanceRecoveryCandidateFilters = Readonly<{
  limit: number;
  cursorBusinessDate: string | null;
  cursorPersonId: string | null;
}>;

export function parseAttendanceRecoveryCandidateFilters(request: Request): AttendanceRecoveryCandidateFilters | undefined {
  const params = new URL(request.url).searchParams;
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) return undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return undefined;

  const rawCursor = params.get("cursor");
  if (!rawCursor) return { limit, cursorBusinessDate: null, cursorPersonId: null };
  const [businessDate, personId, ...extra] = rawCursor.split("~");
  if (extra.length || !businessDate || !validDate(businessDate) || !personId || !uuidPattern.test(personId)) {
    return undefined;
  }
  return { limit, cursorBusinessDate: businessDate, cursorPersonId: personId };
}

/**
 * The caller must pass the explicit permission preflight before this query is
 * run. This second scope check is deliberately target- and historical-date
 * aware so pagination can never widen the set authorized by the POST command.
 */
export const attendanceRecoveryCandidatesReadSql = `WITH request_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
), scoped_days AS MATERIALIZED (
  SELECT people.id AS person_id,
         COALESCE(people.display_name, 'Unnamed person') AS person_name,
         offices.id AS office_id,
         offices.name AS office_name,
         offices.timezone AS office_timezone,
         day.business_date::date AS business_date,
         attendance.id AS attendance_day_id,
         attendance.mode::text AS mode,
         attendance.checked_in_at,
         attendance.checked_out_at
  FROM nova.people people
  JOIN nova.person_office_assignments office_assignments ON office_assignments.person_id = people.id
  JOIN nova.offices offices ON offices.id = office_assignments.office_id
    AND offices.organisation_id = people.organisation_id
    AND offices.archived_at IS NULL
  JOIN LATERAL (SELECT nova.person_business_date(people.id) AS business_today) target_date ON true
  CROSS JOIN request_clock
  CROSS JOIN LATERAL generate_series(
    GREATEST(
      office_assignments.effective_on,
      target_date.business_today - 31,
      ((request_clock.at AT TIME ZONE offices.timezone)::date - 31)
    ),
    LEAST(
      COALESCE(office_assignments.effective_until, target_date.business_today - 1),
      target_date.business_today - 1,
      ((request_clock.at AT TIME ZONE offices.timezone)::date - 1)
    ),
    interval '1 day'
  ) AS day(business_date)
  LEFT JOIN nova.attendance_days attendance
    ON attendance.organisation_id = people.organisation_id
   AND attendance.person_id = people.id
   AND attendance.business_date = day.business_date::date
  WHERE people.organisation_id = $1
    AND office_assignments.effective_on <= day.business_date::date
    AND (office_assignments.effective_until IS NULL OR office_assignments.effective_until >= day.business_date::date)
    AND EXISTS (
      SELECT 1
      FROM nova.person_status_periods status_periods
      WHERE status_periods.person_id = people.id
        AND status_periods.status IN ('active', 'notice')
        AND status_periods.effective_at < ((day.business_date::date + 1)::timestamp AT TIME ZONE offices.timezone)
        AND (status_periods.ended_at IS NULL OR status_periods.ended_at > (day.business_date::date::timestamp AT TIME ZONE offices.timezone))
    )
    AND EXISTS (
      SELECT 1
      FROM nova.office_calendar_assignments calendar_assignments
      JOIN nova.working_calendars calendars ON calendars.id = calendar_assignments.calendar_id
        AND calendars.organisation_id = people.organisation_id AND calendars.archived_at IS NULL
      JOIN LATERAL (
        SELECT rules.is_working
        FROM nova.working_calendar_rules rules
        WHERE rules.calendar_id = calendars.id
          AND rules.weekday = EXTRACT(DOW FROM day.business_date::date)::smallint
          AND rules.ordinal IN (0, ((EXTRACT(DAY FROM day.business_date::date)::integer - 1) / 7) + 1)
        ORDER BY rules.ordinal DESC
        LIMIT 1
      ) selected_rule ON selected_rule.is_working
      WHERE calendar_assignments.office_id = offices.id
        AND calendar_assignments.effective_on <= day.business_date::date
        AND (calendar_assignments.effective_until IS NULL OR calendar_assignments.effective_until >= day.business_date::date)
    )
    AND NOT EXISTS (
      SELECT 1 FROM nova.office_holidays holidays
      WHERE holidays.office_id = offices.id AND holidays.holiday_date = day.business_date::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM nova.leave_request_days leave_days
      JOIN nova.leave_requests leave_requests ON leave_requests.id = leave_days.request_id
      WHERE leave_days.organisation_id = people.organisation_id
        AND leave_days.person_id = people.id
        AND leave_days.business_date = day.business_date::date
        AND (
          leave_requests.status IN ('requested', 'pending')
          OR (leave_requests.status = 'approved' AND leave_days.portion = 1.0)
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM nova.wfh_provisional_attendance provisional
      WHERE provisional.organisation_id = people.organisation_id
        AND provisional.person_id = people.id
        AND provisional.business_date = day.business_date::date
        AND provisional.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM nova.attendance_corrections corrections
      WHERE corrections.organisation_id = people.organisation_id
        AND corrections.person_id = people.id
        AND corrections.business_date = day.business_date::date
    )
    AND (
      (attendance.id IS NULL AND EXISTS (
        SELECT 1
        FROM nova.person_role_assignments required_roles
        JOIN nova.roles required_role ON required_role.id = required_roles.role_id
        JOIN nova.role_operational_policies policies ON policies.role_id = required_role.id
        WHERE required_roles.person_id = people.id
          AND required_roles.effective_on <= day.business_date::date
          AND (required_roles.effective_until IS NULL OR required_roles.effective_until >= day.business_date::date)
          AND required_role.archived_at IS NULL
          AND policies.attendance_required
      ))
      OR (attendance.id IS NOT NULL AND attendance.checked_out_at IS NULL)
    )
    AND EXISTS (
      SELECT 1
      FROM nova.person_role_assignments actor_roles
      JOIN nova.roles actor_role ON actor_role.id = actor_roles.role_id
      JOIN nova.role_permission_grants grants ON grants.role_id = actor_role.id
      WHERE actor_roles.person_id = $2
        AND actor_roles.effective_on <= day.business_date::date
        AND (actor_roles.effective_until IS NULL OR actor_roles.effective_until >= day.business_date::date)
        AND actor_role.archived_at IS NULL
        AND grants.permission_key = 'attendance.recover'
        AND (
          grants.scope = 'organisation'
          OR (grants.scope = 'own_record' AND people.id = $2)
          OR (grants.scope = 'office' AND office_assignments.office_id = grants.office_id)
          OR (grants.scope = 'organisation_department' AND EXISTS (
            SELECT 1 FROM nova.person_department_assignments departments
            WHERE departments.person_id = people.id
              AND departments.organisation_department_id = grants.organisation_department_id
              AND departments.effective_on <= day.business_date::date
              AND (departments.effective_until IS NULL OR departments.effective_until >= day.business_date::date)
          ))
        )
    )
), eligible_candidates AS MATERIALIZED (
  SELECT scoped_days.*,
         CASE WHEN scoped_days.attendance_day_id IS NULL THEN 'missing_attendance' ELSE 'missing_checkout' END AS recovery_reason
  FROM scoped_days
  WHERE scoped_days.attendance_day_id IS NULL OR scoped_days.checked_out_at IS NULL
)
SELECT person_id, person_name, office_id, office_name, office_timezone,
       business_date::text, attendance_day_id, mode,
       checked_in_at, checked_out_at, recovery_reason
FROM eligible_candidates
WHERE $3::date IS NULL OR (business_date, person_id) < ($3::date, $4::uuid)
ORDER BY business_date DESC, person_id DESC
LIMIT $5`;

async function hasCurrentRecoveryGrant(transaction: PoolClient, actorId: string): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `WITH actor_date AS MATERIALIZED (SELECT nova.person_business_date($1) AS business_date)
     SELECT EXISTS (
       SELECT 1
       FROM actor_date
       JOIN nova.person_role_assignments assignments ON assignments.person_id = $1
         AND assignments.effective_on <= actor_date.business_date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= actor_date.business_date)
       JOIN nova.roles roles ON roles.id = assignments.role_id AND roles.archived_at IS NULL
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
         AND grants.permission_key = 'attendance.recover'
       WHERE grants.scope = 'organisation'
          OR grants.scope = 'own_record'
          OR (grants.scope = 'office' AND EXISTS (
            SELECT 1 FROM nova.person_office_assignments offices
            WHERE offices.person_id = $1 AND offices.office_id = grants.office_id
              AND offices.effective_on <= actor_date.business_date
              AND (offices.effective_until IS NULL OR offices.effective_until >= actor_date.business_date)
          ))
          OR (grants.scope = 'organisation_department' AND EXISTS (
            SELECT 1 FROM nova.person_department_assignments departments
            WHERE departments.person_id = $1
              AND departments.organisation_department_id = grants.organisation_department_id
              AND departments.effective_on <= actor_date.business_date
              AND (departments.effective_until IS NULL OR departments.effective_until >= actor_date.business_date)
          ))
     ) AS permitted`,
    [actorId],
  );
  return result.rows[0]?.permitted === true;
}

export async function readAttendanceRecoveryCandidates(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const filters = parseAttendanceRecoveryCandidateFilters(request);
  if (!filters) return json({ error: "ATTENDANCE_RECOVERY_CANDIDATES_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasCurrentRecoveryGrant(transaction, actor.context.userId)) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query<{
        person_id: string;
        person_name: string;
        office_id: string;
        office_name: string;
        office_timezone: string;
        business_date: string;
        attendance_day_id: string | null;
        mode: "office" | "wfh" | null;
        checked_in_at: Date | null;
        checked_out_at: Date | null;
        recovery_reason: "missing_attendance" | "missing_checkout";
      }>(attendanceRecoveryCandidatesReadSql, [
        actor.context.organisationId,
        actor.context.userId,
        filters.cursorBusinessDate,
        filters.cursorPersonId,
        filters.limit + 1,
      ]);
      const hasMore = rows.rows.length > filters.limit;
      const page = rows.rows.slice(0, filters.limit);
      const last = page.at(-1);
      return {
        candidates: page.map((row) => ({
          personId: row.person_id,
          personName: row.person_name,
          businessDate: row.business_date,
          officeId: row.office_id,
          officeName: row.office_name,
          officeTimezone: row.office_timezone,
          attendanceDayId: row.attendance_day_id,
          recoveryReason: row.recovery_reason,
          mode: row.mode,
          checkedInAt: row.checked_in_at,
          checkedOutAt: row.checked_out_at,
        })),
        nextCursor: hasMore && last ? `${last.business_date}~${last.person_id}` : null,
      };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

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
