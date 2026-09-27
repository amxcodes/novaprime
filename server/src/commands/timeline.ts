import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function validTimelineDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

async function normalActor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); } catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const value = await requestActor(request);
  if (!value) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(value)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: value.context };
}

async function canView(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  targetPersonId: string,
): Promise<boolean> {
  const result = await transaction.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1 AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL AND grants.permission_key = 'work.timeline.view'
         AND (
           grants.scope = 'organisation'
           OR (grants.scope = 'own_record' AND $1 = $2)
           OR (grants.scope = 'office' AND EXISTS (
             SELECT 1 FROM nova.person_office_assignments target_offices
             WHERE target_offices.person_id = $2 AND target_offices.office_id = grants.office_id
               AND target_offices.effective_on <= nova.person_business_date($2)
               AND (target_offices.effective_until IS NULL OR target_offices.effective_until >= nova.person_business_date($2))
           ))
           OR (grants.scope = 'organisation_department' AND EXISTS (
             SELECT 1 FROM nova.person_department_assignments target_departments
             WHERE target_departments.person_id = $2
               AND target_departments.organisation_department_id = grants.organisation_department_id
               AND target_departments.effective_on <= nova.person_business_date($2)
               AND (target_departments.effective_until IS NULL OR target_departments.effective_until >= nova.person_business_date($2))
           ))
           OR (grants.scope = 'client' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments target_assignments
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             JOIN nova.client_workstreams target_workstreams ON target_workstreams.id = target_tasks.client_workstream_id
             WHERE target_assignments.organisation_id = $3
               AND target_assignments.person_id = $2
               AND target_workstreams.client_id = grants.client_id
           ))
           OR (grants.scope = 'client_workstream' AND EXISTS (
             SELECT 1 FROM nova.task_assignments target_assignments
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             WHERE target_assignments.organisation_id = $3
               AND target_assignments.person_id = $2
               AND target_tasks.client_workstream_id = grants.client_workstream_id
           ))
           OR (grants.scope = 'group' AND EXISTS (
             SELECT 1 FROM nova.task_assignments target_assignments
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             WHERE target_assignments.organisation_id = $3
               AND target_assignments.person_id = $2
               AND target_tasks.work_group_id = grants.group_id
           ))
           OR (grants.scope = 'assigned_work' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments actor_assignments
             JOIN nova.task_assignments target_assignments ON target_assignments.task_id = actor_assignments.task_id
             WHERE actor_assignments.organisation_id = $3
               AND target_assignments.organisation_id = $3
               AND actor_assignments.person_id = $1
               AND target_assignments.person_id = $2
           ))
         )
     ) AS allowed`,
    [actorId, targetPersonId, organisationId],
  );
  return result.rows[0]?.allowed === true;
}

async function canAdjustTarget(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  targetPersonId: string,
): Promise<boolean> {
  const result = await transaction.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1 AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL
         AND grants.permission_key = $2
         AND (
           grants.scope = 'organisation'
           OR (grants.scope = 'own_record' AND $1 = $3)
           OR (grants.scope = 'office' AND EXISTS (
             SELECT 1 FROM nova.person_office_assignments target_offices
             WHERE target_offices.person_id = $3 AND target_offices.office_id = grants.office_id
               AND target_offices.effective_on <= nova.person_business_date($3)
               AND (target_offices.effective_until IS NULL OR target_offices.effective_until >= nova.person_business_date($3))
           ))
           OR (grants.scope = 'organisation_department' AND EXISTS (
             SELECT 1 FROM nova.person_department_assignments target_departments
             WHERE target_departments.person_id = $3
               AND target_departments.organisation_department_id = grants.organisation_department_id
               AND target_departments.effective_on <= nova.person_business_date($3)
               AND (target_departments.effective_until IS NULL OR target_departments.effective_until >= nova.person_business_date($3))
           ))
           OR (grants.scope = 'client' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments actor_assignments
             JOIN nova.task_assignments target_assignments ON target_assignments.task_id = actor_assignments.task_id
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             JOIN nova.client_workstreams target_workstreams ON target_workstreams.id = target_tasks.client_workstream_id
             WHERE actor_assignments.organisation_id = $4
               AND target_assignments.organisation_id = $4
               AND actor_assignments.person_id = $1
               AND target_assignments.person_id = $3
               AND target_workstreams.client_id = grants.client_id
           ))
           OR (grants.scope = 'client_workstream' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments actor_assignments
             JOIN nova.task_assignments target_assignments ON target_assignments.task_id = actor_assignments.task_id
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             WHERE actor_assignments.organisation_id = $4
               AND target_assignments.organisation_id = $4
               AND actor_assignments.person_id = $1
               AND target_assignments.person_id = $3
               AND target_tasks.client_workstream_id = grants.client_workstream_id
           ))
           OR (grants.scope = 'group' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments actor_assignments
             JOIN nova.task_assignments target_assignments ON target_assignments.task_id = actor_assignments.task_id
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             WHERE actor_assignments.organisation_id = $4
               AND target_assignments.organisation_id = $4
               AND actor_assignments.person_id = $1
               AND target_assignments.person_id = $3
               AND target_tasks.work_group_id = grants.group_id
           ))
           OR (grants.scope = 'assigned_work' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments actor_assignments
             JOIN nova.task_assignments target_assignments ON target_assignments.task_id = actor_assignments.task_id
             WHERE actor_assignments.organisation_id = $4
               AND target_assignments.organisation_id = $4
               AND actor_assignments.person_id = $1
               AND target_assignments.person_id = $3
           ))
         )
     ) AS allowed`,
    [actorId, targetPersonId === actorId ? 'work.timeline_adjust_own' : 'work.timeline_adjust_others', targetPersonId, organisationId],
  );
  return result.rows[0]?.allowed === true;
}

export async function readTimeline(request: Request): Promise<Response> {
  const access = await normalActor(request);
  if ("response" in access) return access.response;
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const requestedPersonId = url.searchParams.get("personId");
  if (date && !validTimelineDate(date)) return json({ error: "TIMELINE_DATE_INVALID" }, 400);
  if (requestedPersonId && !uuidPattern.test(requestedPersonId)) return json({ error: "TIMELINE_PERSON_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(access.context, async (transaction) => {
      const targetPersonId = requestedPersonId ?? access.context.userId;
      if (!await canView(transaction, access.context.userId, access.context.organisationId, targetPersonId)) return "PERMISSION_DENIED" as const;
      const resolvedDate = date ?? (await transaction.query<{ date: string }>(
        "SELECT nova.person_business_date($1)::text AS date", [targetPersonId],
      )).rows[0]?.date;
      if (!resolvedDate) throw new Error("TIMELINE_DATE_MISSING");
      const attendance = await transaction.query<{
        id: string; business_date: string; mode: string; checked_in_at: Date; checked_out_at: Date | null; closure_reason: string | null; boundary_at: Date;
      }>(
        `SELECT attendance.id, attendance.business_date::text, attendance.mode,
                attendance.checked_in_at, attendance.checked_out_at, attendance.closure_reason,
                ((attendance.business_date + 1)::timestamp AT TIME ZONE offices.timezone) AS boundary_at
         FROM nova.attendance_days attendance
         JOIN nova.offices offices ON offices.id = attendance.office_id
         WHERE attendance.organisation_id = $1 AND attendance.person_id = $2 AND attendance.business_date = $3::date`,
        [access.context.organisationId, targetPersonId, resolvedDate],
      );
      const attendancePolicy = await transaction.query<{
        mode: "hour_based" | "scheduled";
        required_attendance_minutes: number;
        timezone: string;
        shift_id: string | null;
        scheduled_start: Date | null;
        scheduled_end: Date | null;
        grace_minutes: number | null; spans_midnight: boolean | null;
        is_holiday: boolean;
        day_end: Date;
      }>(
        `WITH office AS (
           SELECT offices.id AS office_id, offices.timezone
           FROM nova.person_office_assignments assignments
           JOIN nova.offices offices ON offices.id = assignments.office_id
           WHERE assignments.person_id = $2
             AND assignments.effective_on <= $3::date
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= $3::date)
             AND offices.archived_at IS NULL
           ORDER BY assignments.effective_on DESC
           LIMIT 1
         ), policy AS (
           SELECT mode, required_attendance_minutes
           FROM nova.organisation_attendance_policies
           WHERE organisation_id = $1
             AND effective_on <= $3::date
             AND (effective_until IS NULL OR effective_until >= $3::date)
           ORDER BY effective_on DESC
           LIMIT 1
         ), calendar AS (
           SELECT assignments.calendar_id
           FROM nova.office_calendar_assignments assignments
           JOIN office ON office.office_id = assignments.office_id
           WHERE assignments.effective_on <= $3::date
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= $3::date)
           ORDER BY assignments.effective_on DESC
           LIMIT 1
         ), rule AS (
           SELECT rules.is_working, rules.shift_id
           FROM nova.working_calendar_rules rules
           JOIN calendar ON calendar.calendar_id = rules.calendar_id
           WHERE rules.weekday = EXTRACT(DOW FROM $3::date)::smallint
             AND rules.ordinal IN (0, ((EXTRACT(DAY FROM $3::date)::integer - 1) / 7) + 1)
           ORDER BY rules.ordinal DESC
           LIMIT 1
         ), holiday AS (
           SELECT EXISTS (
             SELECT 1
             FROM nova.office_holidays holidays
             JOIN office ON office.office_id = holidays.office_id
             WHERE holidays.holiday_date = $3::date
           ) AS is_holiday
         )
         SELECT COALESCE(policy.mode, 'hour_based'::nova.attendance_policy_mode) AS mode,
                COALESCE(policy.required_attendance_minutes, 480) AS required_attendance_minutes,
                office.timezone,
                CASE WHEN rule.is_working AND NOT holiday.is_holiday THEN shifts.id END AS shift_id,
                CASE WHEN rule.is_working AND NOT holiday.is_holiday
                  THEN (($3::date + shifts.start_local_time) AT TIME ZONE office.timezone)
                END AS scheduled_start,
                CASE WHEN rule.is_working AND NOT holiday.is_holiday
                   THEN ((($3::date + CASE WHEN shifts.spans_midnight THEN 1 ELSE 0 END) + shifts.end_local_time) AT TIME ZONE office.timezone)
                 END AS scheduled_end,
                 CASE WHEN rule.is_working AND NOT holiday.is_holiday THEN shifts.grace_minutes END AS grace_minutes,
                 CASE WHEN rule.is_working AND NOT holiday.is_holiday THEN shifts.spans_midnight ELSE false END AS spans_midnight,
                holiday.is_holiday,
                ((($3::date + 1)::timestamp AT TIME ZONE office.timezone) - interval '1 microsecond') AS day_end
         FROM office
         LEFT JOIN policy ON true
         CROSS JOIN holiday
         LEFT JOIN rule ON true
         LEFT JOIN nova.shifts shifts ON shifts.id = rule.shift_id AND shifts.archived_at IS NULL`,
        [access.context.organisationId, targetPersonId, resolvedDate],
      );
      const policyRow = attendancePolicy.rows[0];
      const now = new Date();
      const businessDayEnd = policyRow?.day_end ? new Date(policyRow.day_end) : now;
      const attendanceBoundary = attendance.rows[0]?.boundary_at ? new Date(attendance.rows[0].boundary_at) : undefined;
      const timelineEnd = [businessDayEnd, now, attendanceBoundary].filter((value): value is Date => Boolean(value)).reduce(
        (earliest, value) => value < earliest ? value : earliest,
        now,
      );
      const sessions = await transaction.query<{
        id: string; assignment_id: string; task_id: string; title: string; started_at: Date; ended_at: Date | null; state: string; closure_reason: string | null; boundary_at: Date | null;
      }>(
        `WITH office AS (
           SELECT offices.timezone
           FROM nova.person_office_assignments assignments
           JOIN nova.offices offices ON offices.id = assignments.office_id
           WHERE assignments.person_id = $2 AND assignments.effective_on <= $3::date
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= $3::date)
           ORDER BY assignments.effective_on DESC LIMIT 1
         )
         SELECT sessions.id, sessions.assignment_id, tasks.id AS task_id, tasks.title,
                sessions.started_at, sessions.ended_at, sessions.state, sessions.closure_reason,
                CASE WHEN session_office.timezone IS NOT NULL
                  THEN ((sessions.started_at AT TIME ZONE session_office.timezone)::date + 1)::timestamp
                    AT TIME ZONE session_office.timezone
                END AS boundary_at
         FROM nova.work_sessions sessions
         JOIN nova.task_assignments assignments ON assignments.id = sessions.assignment_id
         JOIN nova.tasks tasks ON tasks.id = assignments.task_id
         LEFT JOIN nova.offices session_office ON session_office.id = sessions.office_id
         CROSS JOIN office
         WHERE sessions.organisation_id = $1 AND sessions.person_id = $2
           AND sessions.started_at < (($3::date + 1)::timestamp AT TIME ZONE office.timezone)
           AND COALESCE(sessions.ended_at, 'infinity'::timestamptz) >= ($3::date::timestamp AT TIME ZONE office.timezone)
         ORDER BY sessions.started_at`,
        [access.context.organisationId, targetPersonId, resolvedDate],
      );
      const adjustments = await transaction.query<{
        id: string; assignment_id: string | null; started_at: Date; ended_at: Date; reason: string;
      }>(
        `WITH office AS (
           SELECT offices.timezone
           FROM nova.person_office_assignments assignments
           JOIN nova.offices offices ON offices.id = assignments.office_id
           WHERE assignments.person_id = $2
             AND assignments.effective_on <= $3::date
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= $3::date)
           ORDER BY assignments.effective_on DESC LIMIT 1
         )
         SELECT adjustments.id, adjustments.assignment_id, adjustments.started_at,
                adjustments.ended_at, adjustments.reason
         FROM nova.work_timeline_adjustments adjustments
         CROSS JOIN office
         WHERE adjustments.organisation_id = $1 AND adjustments.person_id = $2
           AND adjustments.started_at < (($3::date + 1)::timestamp AT TIME ZONE office.timezone)
           AND adjustments.ended_at >= ($3::date::timestamp AT TIME ZONE office.timezone)
         ORDER BY adjustments.started_at`,
        [access.context.organisationId, targetPersonId, resolvedDate],
      );
      const segments = [
        ...sessions.rows.map((row) => {
          const boundary = row.boundary_at ? new Date(row.boundary_at) : timelineEnd;
          return {
            startedAt: new Date(row.started_at),
            endedAt: row.ended_at ? new Date(row.ended_at) : (boundary < timelineEnd ? boundary : timelineEnd),
            sourceId: row.id,
            assignmentId: row.assignment_id,
            kind: "session" as const,
          };
        }),
        ...adjustments.rows.map((row) => ({ startedAt: new Date(row.started_at), endedAt: new Date(row.ended_at), sourceId: row.id, assignmentId: row.assignment_id, kind: "adjustment" as const })),
      ].sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
      const attendanceRow = attendance.rows[0];
      const adjustmentAllowed = await canAdjustTarget(transaction, access.context.userId, access.context.organisationId, targetPersonId);
      const exceptions: Array<Record<string, unknown>> = [];
      if (attendanceRow) {
        const attendanceStart = new Date(attendanceRow.checked_in_at);
        const attendanceEnd = attendanceRow.checked_out_at ? new Date(attendanceRow.checked_out_at) : timelineEnd;
        let cursor = attendanceStart;
        for (const segment of segments) {
          if (segment.endedAt <= attendanceStart || segment.startedAt >= attendanceEnd) continue;
          const boundedStart = segment.startedAt < attendanceStart ? attendanceStart : segment.startedAt;
          const boundedEnd = segment.endedAt > attendanceEnd ? attendanceEnd : segment.endedAt;
          if (boundedStart > cursor) {
            exceptions.push({
              type: "work.untracked_gap",
              startedAt: cursor,
              endedAt: boundedStart,
              actionable: adjustmentAllowed,
            });
          }
          if (boundedEnd > cursor) cursor = boundedEnd;
          if (segment.startedAt < attendanceStart || segment.endedAt > attendanceEnd) {
            exceptions.push({ type: "work.outside_attendance", sourceId: segment.sourceId, assignmentId: segment.assignmentId, startedAt: segment.startedAt, endedAt: segment.endedAt });
          }
        }
        if (cursor < attendanceEnd) {
          exceptions.push({
            type: "work.untracked_gap",
            startedAt: cursor,
            endedAt: attendanceEnd,
            actionable: adjustmentAllowed,
          });
        }
      } else if (segments.length > 0) {
        exceptions.push({ type: "work.without_attendance", actionable: false });
      }
      const events: Array<Record<string, unknown>> = [
        ...attendance.rows.flatMap((row) => [
          { type: "attendance.check_in", at: row.checked_in_at, sourceId: row.id, mode: row.mode },
          ...(row.checked_out_at ? [{ type: "attendance.check_out", at: row.checked_out_at, sourceId: row.id, mode: row.mode, closureReason: row.closure_reason }] : []),
        ]),
        ...sessions.rows.flatMap((row) => [
          { type: "work.started", at: row.started_at, sourceId: row.id, assignmentId: row.assignment_id, taskId: row.task_id, title: row.title },
          ...(row.ended_at ? [{ type: "work.ended", at: row.ended_at, sourceId: row.id, assignmentId: row.assignment_id, taskId: row.task_id, title: row.title, state: row.state, closureReason: row.closure_reason }] : []),
        ]).sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime()),
        ...adjustments.rows.flatMap((row) => [
          { type: "work.adjustment.started", at: row.started_at, sourceId: row.id, assignmentId: row.assignment_id, reason: row.reason },
          { type: "work.adjustment.ended", at: row.ended_at, sourceId: row.id, assignmentId: row.assignment_id, reason: row.reason },
        ]),
      ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
      const scheduledStart = policyRow?.scheduled_start ? new Date(policyRow.scheduled_start) : null;
      const scheduledEnd = policyRow?.scheduled_end ? new Date(policyRow.scheduled_end) : null;
      const graceMinutes = policyRow?.grace_minutes ?? 0;
      const durationMinutes = attendanceRow
        ? Math.max(0, Math.floor(((attendanceRow.checked_out_at ? new Date(attendanceRow.checked_out_at) : timelineEnd).getTime() - new Date(attendanceRow.checked_in_at).getTime()) / 60_000))
        : 0;
      if (policyRow?.mode === "scheduled" && scheduledStart && scheduledEnd && attendanceRow) {
        const graceMilliseconds = graceMinutes * 60_000;
        const checkedInAt = new Date(attendanceRow.checked_in_at);
        const checkedOutAt = attendanceRow.checked_out_at ? new Date(attendanceRow.checked_out_at) : null;
        if (checkedInAt.getTime() > scheduledStart.getTime() + graceMilliseconds) {
          events.push({
            type: "attendance.late",
            at: checkedInAt,
            sourceId: attendanceRow.id,
            scheduledAt: scheduledStart,
            minutesLate: Math.ceil((checkedInAt.getTime() - scheduledStart.getTime() - graceMilliseconds) / 60_000),
          });
        }
        if (checkedOutAt && checkedOutAt.getTime() < scheduledEnd.getTime() - graceMilliseconds) {
          events.push({
            type: "attendance.early_departure",
            at: checkedOutAt,
            sourceId: attendanceRow.id,
            scheduledAt: scheduledEnd,
            minutesEarly: Math.ceil((scheduledEnd.getTime() - graceMilliseconds - checkedOutAt.getTime()) / 60_000),
          });
        }
        if (checkedOutAt && checkedOutAt.getTime() > scheduledEnd.getTime() + graceMilliseconds) {
          events.push({
            type: "attendance.after_hours",
            at: checkedOutAt,
            sourceId: attendanceRow.id,
            scheduledAt: scheduledEnd,
            minutesAfter: Math.ceil((checkedOutAt.getTime() - scheduledEnd.getTime() - graceMilliseconds) / 60_000),
          });
        }
        events.sort((left, right) => new Date(String(left.at)).getTime() - new Date(String(right.at)).getTime());
      }
      return {
        date: resolvedDate,
        personId: targetPersonId,
        attendance: attendance.rows[0] ?? null,
        attendanceSummary: {
          durationMinutes,
          requiredMinutes: policyRow?.required_attendance_minutes ?? 480,
          requirementSatisfied: policyRow?.mode === "hour_based" && durationMinutes >= (policyRow.required_attendance_minutes ?? 480),
        },
        attendancePolicy: policyRow ? {
          mode: policyRow.mode,
          requiredAttendanceMinutes: policyRow.required_attendance_minutes,
          timezone: policyRow.timezone,
          shiftId: policyRow.shift_id,
          scheduledStart,
          scheduledEnd,
          graceMinutes,
          isHoliday: policyRow.is_holiday,
        } : null,
        sessions: sessions.rows,
        adjustments: adjustments.rows,
        exceptions,
        events,
      };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
