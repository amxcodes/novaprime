import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { reconcileOfficeDate } from "./availability-reconciliation.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type ShiftInput = Readonly<{
  breakEndLocalTime?: string;
  breakStartLocalTime?: string;
  endLocalTime: string;
  graceMinutes: number;
  name: string;
  overtimeEnabled: boolean;
  spansMidnight: boolean;
  startLocalTime: string;
}>;

export type CalendarRuleInput = Readonly<{
  isWorking: boolean;
  ordinal: number;
  shiftId?: string;
  weekday: number;
}>;

type CalendarInput = Readonly<{
  effectiveOn: string;
  name: string;
  officeId: string;
  rules: readonly CalendarRuleInput[];
}>;

type HolidayInput = Readonly<{
  date: string;
  name: string;
  officeId: string;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function nonEmptyString(value: unknown, maximum = 180): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= maximum ? result : undefined;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function shiftInput(body: unknown): ShiftInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const name = nonEmptyString(candidate.name);
  const startLocalTime = candidate.startLocalTime;
  const endLocalTime = candidate.endLocalTime;
  const breakStartLocalTime = candidate.breakStartLocalTime;
  const breakEndLocalTime = candidate.breakEndLocalTime;
  const graceMinutes = candidate.graceMinutes ?? 0;
  const overtimeEnabled = candidate.overtimeEnabled ?? false;
  const spansMidnight = candidate.spansMidnight === undefined
    ? typeof startLocalTime === "string" && typeof endLocalTime === "string" &&
      timeMinutes(endLocalTime) < timeMinutes(startLocalTime)
    : candidate.spansMidnight;
  if (
    !name ||
    typeof startLocalTime !== "string" || !timePattern.test(startLocalTime) ||
    typeof endLocalTime !== "string" || !timePattern.test(endLocalTime) ||
    timeMinutes(endLocalTime) === timeMinutes(startLocalTime) ||
    typeof spansMidnight !== "boolean" ||
    (!spansMidnight && timeMinutes(endLocalTime) < timeMinutes(startLocalTime)) ||
    typeof graceMinutes !== "number" || !Number.isInteger(graceMinutes) ||
    graceMinutes < 0 || graceMinutes > 720 ||
    typeof overtimeEnabled !== "boolean"
  ) return undefined;

  const hasBreakStart = breakStartLocalTime !== undefined && breakStartLocalTime !== null;
  const hasBreakEnd = breakEndLocalTime !== undefined && breakEndLocalTime !== null;
  if (hasBreakStart !== hasBreakEnd || (spansMidnight && (hasBreakStart || hasBreakEnd))) return undefined;
  if (hasBreakStart && (
    typeof breakStartLocalTime !== "string" || !timePattern.test(breakStartLocalTime) ||
    typeof breakEndLocalTime !== "string" || !timePattern.test(breakEndLocalTime) ||
    timeMinutes(breakStartLocalTime) < timeMinutes(startLocalTime) ||
    timeMinutes(breakEndLocalTime) > timeMinutes(endLocalTime) ||
    timeMinutes(breakEndLocalTime) <= timeMinutes(breakStartLocalTime)
  )) return undefined;

  return Object.freeze({
    name,
    startLocalTime,
    endLocalTime,
    ...(hasBreakStart ? {
      breakStartLocalTime: breakStartLocalTime as string,
      breakEndLocalTime: breakEndLocalTime as string,
    } : {}),
    graceMinutes,
    overtimeEnabled,
    spansMidnight,
  });
}

function ruleInput(value: unknown): CalendarRuleInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const weekday = candidate.weekday;
  const ordinal = candidate.ordinal ?? 0;
  const isWorking = candidate.isWorking;
  const shiftId = candidate.shiftId;
  if (
    typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
    typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 5 ||
    typeof isWorking !== "boolean"
  ) return undefined;
  if (isWorking !== (typeof shiftId === "string" && uuidPattern.test(shiftId))) return undefined;
  if (!isWorking && shiftId !== undefined && shiftId !== null) return undefined;
  return Object.freeze({
    weekday,
    ordinal,
    isWorking,
    ...(isWorking ? { shiftId: shiftId as string } : {}),
  });
}

export function calendarInput(body: unknown): CalendarInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const name = nonEmptyString(candidate.name);
  const officeId = candidate.officeId;
  const effectiveOn = candidate.effectiveOn;
  if (!name || typeof officeId !== "string" || !uuidPattern.test(officeId) || !validDate(effectiveOn)) {
    return undefined;
  }
  if (!Array.isArray(candidate.rules) || candidate.rules.length < 7 || candidate.rules.length > 42) {
    return undefined;
  }
  const rules = candidate.rules.map(ruleInput);
  if (rules.some((rule) => !rule)) return undefined;
  const typedRules = rules as CalendarRuleInput[];
  const keys = new Set(typedRules.map((rule) => `${rule.weekday}:${rule.ordinal}`));
  if (keys.size !== typedRules.length || !typedRules.some((rule) => rule.weekday === 0 && rule.ordinal === 0) ||
    !typedRules.some((rule) => rule.weekday === 1 && rule.ordinal === 0) ||
    !typedRules.some((rule) => rule.weekday === 2 && rule.ordinal === 0) ||
    !typedRules.some((rule) => rule.weekday === 3 && rule.ordinal === 0) ||
    !typedRules.some((rule) => rule.weekday === 4 && rule.ordinal === 0) ||
    !typedRules.some((rule) => rule.weekday === 5 && rule.ordinal === 0) ||
    !typedRules.some((rule) => rule.weekday === 6 && rule.ordinal === 0)) return undefined;
  return Object.freeze({ officeId, name, effectiveOn, rules: Object.freeze(typedRules) });
}

export function holidayInput(body: unknown): HolidayInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const officeId = candidate.officeId;
  const name = nonEmptyString(candidate.name);
  const date = candidate.date;
  if (typeof officeId !== "string" || !uuidPattern.test(officeId) || !name || !validDate(date)) {
    return undefined;
  }
  return Object.freeze({ officeId, name, date });
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

async function requestBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
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

function duplicateError(error: unknown): boolean {
  return error instanceof Error && /duplicate key|unique|exclusion/i.test(error.message);
}

export async function createShift(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = shiftInput(await requestBody(request));
  if (!input) return json({ error: "SHIFT_INPUT_INVALID" }, 400);
  try {
    const shiftId = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.shift.manage")) {
        return "PERMISSION_DENIED" as const;
      }
      const result = await transaction.query<{ id: string }>(
        `INSERT INTO nova.shifts (
          organisation_id, name, start_local_time, end_local_time,
           break_start_local_time, break_end_local_time, grace_minutes, overtime_enabled, spans_midnight
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          actor.context.organisationId,
          input.name,
          input.startLocalTime,
          input.endLocalTime,
          input.breakStartLocalTime ?? null,
          input.breakEndLocalTime ?? null,
          input.graceMinutes,
          input.overtimeEnabled,
          input.spansMidnight,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("SHIFT_CREATE_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.shift.created', 'shift', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, id, JSON.stringify({ name: input.name })],
      );
      return id;
    });
    if (shiftId === "PERMISSION_DENIED") return json({ error: shiftId }, 403);
    return json({ shiftId }, 201);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "SHIFT_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createWorkingCalendar(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = calendarInput(await requestBody(request));
  if (!input) return json({ error: "CALENDAR_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.calendar.manage")) {
        return "PERMISSION_DENIED" as const;
      }
      const office = await transaction.query(
        `SELECT id FROM nova.offices
         WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`,
        [input.officeId, actor.context.organisationId],
      );
      if (office.rows.length !== 1) return "OFFICE_NOT_FOUND" as const;
      const shiftIds = [...new Set(input.rules.filter((rule) => rule.isWorking).map((rule) => rule.shiftId))];
      const shifts = await transaction.query<{ id: string }>(
        `SELECT id FROM nova.shifts
         WHERE organisation_id = $1 AND archived_at IS NULL AND id = ANY($2::uuid[])`,
        [actor.context.organisationId, shiftIds],
      );
      if (shifts.rows.length !== shiftIds.length) return "SHIFT_NOT_FOUND" as const;
      const previousAssignment = await transaction.query<{ id: string; effective_on: string; effective_until: string | null }>(
        `SELECT id, effective_on, effective_until
         FROM nova.office_calendar_assignments
         WHERE office_id = $1
         ORDER BY effective_on DESC
         LIMIT 1
         FOR UPDATE`,
        [input.officeId],
      );
      const previous = previousAssignment.rows[0];
      if (previous && input.effectiveOn <= previous.effective_on) {
        return "CALENDAR_EFFECTIVE_DATE_INVALID" as const;
      }
      if (previous && previous.effective_until === null && previous.effective_on < input.effectiveOn) {
        await transaction.query(
          `UPDATE nova.office_calendar_assignments
           SET effective_until = $2::date - 1
           WHERE id = $1`,
          [previous.id, input.effectiveOn],
        );
      }
      const calendar = await transaction.query<{ id: string }>(
        `INSERT INTO nova.working_calendars (organisation_id, name)
         VALUES ($1, $2) RETURNING id`,
        [actor.context.organisationId, input.name],
      );
      const calendarId = calendar.rows[0]?.id;
      if (!calendarId) throw new Error("CALENDAR_CREATE_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.office_calendar_assignments (office_id, calendar_id, effective_on)
         VALUES ($1, $2, $3)`,
        [input.officeId, calendarId, input.effectiveOn],
      );
      for (const rule of input.rules) {
        await transaction.query(
          `INSERT INTO nova.working_calendar_rules (
            calendar_id, weekday, ordinal, is_working, shift_id
          ) VALUES ($1, $2, $3, $4, $5)`,
          [calendarId, rule.weekday, rule.ordinal, rule.isWorking, rule.shiftId ?? null],
        );
      }
      const affectedDates = await transaction.query<{ business_date: string }>(
        `SELECT DISTINCT attendance.business_date::text
         FROM nova.attendance_days attendance
         WHERE attendance.organisation_id = $1
           AND attendance.office_id = $2
           AND attendance.business_date >= $3::date
           AND (
             EXISTS (
               SELECT 1 FROM nova.office_holidays holidays
               WHERE holidays.office_id = $2 AND holidays.holiday_date = attendance.business_date
             )
             OR COALESCE((
               SELECT rules.is_working
               FROM nova.working_calendar_rules rules
               WHERE rules.calendar_id = $4
                 AND rules.weekday = EXTRACT(DOW FROM attendance.business_date)::smallint
                 AND rules.ordinal IN (0, ((EXTRACT(DAY FROM attendance.business_date)::integer - 1) / 7) + 1)
               ORDER BY rules.ordinal DESC
               LIMIT 1
             ), false) = false
           )
         ORDER BY attendance.business_date::text`,
        [actor.context.organisationId, input.officeId, input.effectiveOn, calendarId],
      );
      for (const affected of affectedDates.rows) {
        await reconcileOfficeDate(transaction, {
          actorId: actor.context.userId,
          businessDate: affected.business_date,
          code: "availability.attendance_closed",
          details: { reason: "working_calendar_change", calendar_id: calendarId },
          officeId: input.officeId,
          organisationId: actor.context.organisationId,
        });
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.calendar.created', 'working_calendar', $3, $4)`,
        [
          actor.context.organisationId,
          actor.context.userId,
          calendarId,
          JSON.stringify({ office_id: input.officeId, effective_on: input.effectiveOn }),
        ],
      );
      const people = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_office_assignments assignments
         JOIN nova.person_status_periods statuses
           ON statuses.person_id = assignments.person_id AND statuses.ended_at IS NULL
         WHERE assignments.office_id = $1
           AND assignments.effective_on <= $2::date
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
           AND statuses.status IN ('active', 'notice')`,
        [input.officeId, input.effectiveOn],
      );
      for (const person of people.rows) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: person.person_id,
          eventKey: "availability.calendar_changed",
          title: "Availability calendar changed",
          body: `Your office calendar was updated from ${input.effectiveOn}.`,
          aggregateType: "working_calendar",
          aggregateId: calendarId,
          deepLink: "/?view=today",
          idempotencyKey: `availability.calendar_changed:${calendarId}:${person.person_id}`,
        });
      }
      return calendarId;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "OFFICE_NOT_FOUND" || result === "SHIFT_NOT_FOUND") return json({ error: result }, 409);
    if (result === "CALENDAR_EFFECTIVE_DATE_INVALID") return json({ error: result }, 409);
    return json({ calendarId: result }, 201);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "CALENDAR_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createOfficeHoliday(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = holidayInput(await requestBody(request));
  if (!input) return json({ error: "HOLIDAY_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.holiday.manage")) {
        return "PERMISSION_DENIED" as const;
      }
      const office = await transaction.query(
        `SELECT id FROM nova.offices
         WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`,
        [input.officeId, actor.context.organisationId],
      );
      if (office.rows.length !== 1) return "OFFICE_NOT_FOUND" as const;
      const holiday = await transaction.query<{ id: string }>(
        `INSERT INTO nova.office_holidays (
          organisation_id, office_id, holiday_date, name, created_by_person_id
        ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [actor.context.organisationId, input.officeId, input.date, input.name, actor.context.userId],
      );
      const holidayId = holiday.rows[0]?.id;
      if (!holidayId) throw new Error("HOLIDAY_CREATE_RESULT_MISSING");
      await reconcileOfficeDate(transaction, {
        actorId: actor.context.userId,
        businessDate: input.date,
        code: "availability.attendance_closed",
        details: { reason: "office_holiday", holiday_id: holidayId },
        officeId: input.officeId,
        organisationId: actor.context.organisationId,
      });
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.holiday.created', 'office_holiday', $3, $4)`,
        [
          actor.context.organisationId,
          actor.context.userId,
          holidayId,
          JSON.stringify({ office_id: input.officeId, holiday_date: input.date }),
        ],
      );
      const people = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_office_assignments assignments
         JOIN nova.person_status_periods statuses
           ON statuses.person_id = assignments.person_id AND statuses.ended_at IS NULL
         WHERE assignments.office_id = $1
           AND assignments.effective_on <= $2::date
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
           AND statuses.status IN ('active', 'notice')`,
        [input.officeId, input.date],
      );
      for (const person of people.rows) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: person.person_id,
          eventKey: "availability.holiday_changed",
          title: "Office holiday added",
          body: `A holiday was added to your office calendar for ${input.date}.`,
          aggregateType: "office_holiday",
          aggregateId: holidayId,
          deepLink: "/?view=today",
          idempotencyKey: `availability.holiday_changed:${holidayId}:${person.person_id}`,
        });
      }
      return holidayId;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "OFFICE_NOT_FOUND") return json({ error: result }, 409);
    return json({ holidayId: result }, 201);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "HOLIDAY_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readAvailabilityConfig(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, "availability.calendar.view")) {
        return undefined;
      }
      const shifts = await transaction.query<{
        id: string; name: string; start_local_time: string; end_local_time: string;
        break_start_local_time: string | null; break_end_local_time: string | null;
        grace_minutes: number; overtime_enabled: boolean; spans_midnight: boolean;
      }>(
        `SELECT id, name, start_local_time, end_local_time,
                break_start_local_time, break_end_local_time,
                grace_minutes, overtime_enabled, spans_midnight
         FROM nova.shifts
         WHERE organisation_id = $1 AND archived_at IS NULL
         ORDER BY name`,
        [actor.context.organisationId],
      );
      const calendars = await transaction.query<{
        id: string; name: string; office_id: string; office_name: string;
        effective_on: string; rules: unknown;
      }>(
        `SELECT calendars.id, calendars.name,
                assignments.office_id, offices.name AS office_name,
                assignments.effective_on,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'weekday', rules.weekday,
                      'ordinal', rules.ordinal,
                      'isWorking', rules.is_working,
                      'shiftId', rules.shift_id
                    ) ORDER BY rules.weekday, rules.ordinal
                  ) FILTER (WHERE rules.id IS NOT NULL), '[]'::json
                ) AS rules
         FROM nova.working_calendars calendars
         JOIN nova.office_calendar_assignments assignments ON assignments.calendar_id = calendars.id
           AND assignments.effective_until IS NULL
         JOIN nova.offices offices ON offices.id = assignments.office_id
         LEFT JOIN nova.working_calendar_rules rules ON rules.calendar_id = calendars.id
         WHERE calendars.organisation_id = $1 AND calendars.archived_at IS NULL
         GROUP BY calendars.id, assignments.office_id, offices.name, assignments.effective_on
         ORDER BY calendars.name`,
        [actor.context.organisationId],
      );
      const holidays = await transaction.query<{
        id: string; office_id: string; office_name: string; holiday_date: string; name: string;
      }>(
        `SELECT holidays.id, holidays.office_id, offices.name AS office_name,
                holidays.holiday_date, holidays.name
         FROM nova.office_holidays holidays
         JOIN nova.offices offices ON offices.id = holidays.office_id
         WHERE holidays.organisation_id = $1
         ORDER BY holidays.holiday_date, offices.name`,
        [actor.context.organisationId],
      );
      return {
        shifts: shifts.rows.map((shift) => ({
          id: shift.id,
          name: shift.name,
          startLocalTime: shift.start_local_time,
          endLocalTime: shift.end_local_time,
          breakStartLocalTime: shift.break_start_local_time,
          breakEndLocalTime: shift.break_end_local_time,
          graceMinutes: shift.grace_minutes,
          overtimeEnabled: shift.overtime_enabled,
          spansMidnight: shift.spans_midnight,
        })),
        calendars: calendars.rows.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          office: { id: calendar.office_id, name: calendar.office_name },
          effectiveOn: calendar.effective_on,
          rules: calendar.rules,
        })),
        holidays: holidays.rows.map((holiday) => ({
          id: holiday.id,
          office: { id: holiday.office_id, name: holiday.office_name },
          date: holiday.holiday_date,
          name: holiday.name,
        })),
      };
    });
    if (!result) return json({ error: "PERMISSION_DENIED" }, 403);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
