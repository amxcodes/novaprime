import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const agendaKinds = new Set(["shift", "holiday", "attendance", "leave", "wfh"]);
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export type AvailabilityAgendaFilters = Readonly<{
  startDate: string;
  endDate: string;
  limit: number;
  cursorDate: string | null;
  cursorKind: string | null;
  cursorKey: string | null;
  cursorAccessRevision: string | null;
}>;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

function validCursorKey(kind: string, key: string): boolean {
  if (kind === "shift") return key.split(":").length === 3 && key.split(":").every((part) => uuidPattern.test(part));
  return uuidPattern.test(key);
}

/** The range is deliberately explicit and capped; every source uses the same business-date window. */
export function parseAvailabilityAgendaFilters(request: Request): AvailabilityAgendaFilters | undefined {
  const params = new URL(request.url).searchParams;
  for (const key of ["startDate", "endDate", "limit", "cursor"]) {
    if (params.getAll(key).length > 1) return undefined;
  }
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate ||
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 > 30 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return undefined;

  const rawCursor = params.get("cursor");
  if (!rawCursor) {
    return {
      startDate, endDate, limit, cursorDate: null, cursorKind: null, cursorKey: null,
      cursorAccessRevision: null,
    };
  }
  const [cursorStart, cursorEnd, cursorDate, cursorKind, cursorKey, cursorAccessRevision, ...extra] = rawCursor.split("~");
  if (extra.length || cursorStart !== startDate || cursorEnd !== endDate ||
      !validDate(cursorDate) || cursorDate < startDate || cursorDate > endDate ||
      !cursorKind || !agendaKinds.has(cursorKind) || !cursorKey || !validCursorKey(cursorKind, cursorKey)) {
    return undefined;
  }
  if (cursorAccessRevision !== undefined && !/^[a-f0-9]{32}$/.test(cursorAccessRevision)) return undefined;
  return { startDate, endDate, limit, cursorDate, cursorKind, cursorKey, cursorAccessRevision: cursorAccessRevision || null };
}

export function hasUnversionedAvailabilityCursor(filters: AvailabilityAgendaFilters): boolean {
  return filters.cursorDate !== null && filters.cursorAccessRevision === null;
}

export function availabilityAgendaAccessOutcome(
  expectedRevision: string | null,
  currentRevision: string | null,
  permitted: boolean,
): "allowed" | "access_changed" | "permission_denied" | "revision_unavailable" {
  if (!currentRevision) return "revision_unavailable";
  if (expectedRevision && expectedRevision !== currentRevision) return "access_changed";
  return permitted ? "allowed" : "permission_denied";
}

/**
 * One event is returned for each scheduled working-day shift, holiday, actual
 * attendance row, leave business date, and approved/pending WFH business date.
 * Holidays remain separate from scheduled shifts so the caller can show the
 * schedule alongside its closure override. Leave portions are preserved.
 * Permission checks and date filters run in each source before shared keyset
 * pagination. Only attendance_days is authoritative attendance; provisional
 * WFH evidence is intentionally excluded.
 */
export const availabilityAgendaReadSql = `
WITH actor_grants AS MATERIALIZED (
  SELECT roles.id AS role_id, assignments.id AS assignment_id,
         assignments.effective_on AS assignment_effective_on,
         assignments.effective_until AS assignment_effective_until,
         grants.permission_key, grants.scope, grants.office_id,
         grants.organisation_department_id, grants.client_id,
         grants.client_workstream_id, grants.group_id
  FROM nova.person_role_assignments assignments
  JOIN nova.roles roles ON roles.id = assignments.role_id
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE assignments.person_id = $2
    AND roles.organisation_id = $1
    AND roles.archived_at IS NULL
    AND assignments.effective_on <= nova.person_business_date($2)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($2))
    AND grants.permission_key = ANY(ARRAY[
      'availability.calendar.view', 'availability.shift.view', 'availability.holiday.view',
      'attendance.view', 'leave.request', 'leave.review',
      'availability.wfh.request', 'availability.wfh.review'
    ]::text[])
), access_state AS MATERIALIZED (
  SELECT grant_state.permitted,
         md5(jsonb_build_object(
           'organisationRevision', revisions.revision,
           'effectiveAgendaGrants', COALESCE((
             SELECT jsonb_agg(
               jsonb_build_array(
                 role_id, assignment_id, assignment_effective_on, assignment_effective_until,
                 permission_key, scope::text, office_id, organisation_department_id,
                 client_id, client_workstream_id, group_id
               )
               ORDER BY role_id, assignment_id, permission_key, scope::text,
                        office_id, organisation_department_id, client_id, client_workstream_id, group_id
             )
             FROM actor_grants
           ), '[]'::jsonb)
         )::text) AS access_revision
  FROM nova.organisation_access_revisions revisions
  CROSS JOIN LATERAL (
    SELECT COALESCE(bool_or(
      (g.permission_key IN ('availability.calendar.view', 'availability.shift.view', 'availability.holiday.view')
        AND g.scope::text = 'organisation')
      OR (g.permission_key = 'attendance.view'
        AND g.scope::text = ANY(ARRAY['organisation', 'own_record', 'office', 'organisation_department']))
      OR (g.permission_key IN ('leave.request', 'leave.review', 'availability.wfh.request', 'availability.wfh.review')
        AND g.scope::text = ANY(ARRAY['organisation', 'own_record', 'office', 'organisation_department']))
    ), false) AS permitted
    FROM actor_grants g
  ) grant_state
  WHERE revisions.organisation_id = $1
), date_window AS MATERIALIZED (
  SELECT $3::date AS start_date, $4::date AS end_date
), agenda_events AS (
  SELECT days.business_date::text AS event_date,
         'shift'::text AS event_kind,
         (offices.id::text || ':' || calendars.id::text || ':' || rules.id::text) AS event_key,
         jsonb_build_object(
           'office', jsonb_build_object('id', offices.id, 'name', offices.name),
           'timezone', offices.timezone,
           'calendar', jsonb_build_object('id', calendars.id, 'name', calendars.name),
           'shift', jsonb_build_object(
             'id', shifts.id, 'name', shifts.name,
             'startLocalTime', shifts.start_local_time,
             'endLocalTime', shifts.end_local_time,
             'breakStartLocalTime', shifts.break_start_local_time,
             'breakEndLocalTime', shifts.break_end_local_time,
             'spansMidnight', shifts.spans_midnight
           )
         ) AS details
  FROM date_window bounds
  CROSS JOIN LATERAL generate_series(bounds.start_date, bounds.end_date, interval '1 day') days(business_date)
  JOIN nova.offices offices ON offices.organisation_id = $1 AND offices.archived_at IS NULL
  JOIN nova.office_calendar_assignments calendar_assignments
    ON calendar_assignments.office_id = offices.id
   AND calendar_assignments.effective_on <= days.business_date::date
   AND (calendar_assignments.effective_until IS NULL OR calendar_assignments.effective_until >= days.business_date::date)
  JOIN nova.working_calendars calendars
    ON calendars.id = calendar_assignments.calendar_id
   AND calendars.organisation_id = $1 AND calendars.archived_at IS NULL
  JOIN LATERAL (
    SELECT candidate.*
    FROM nova.working_calendar_rules candidate
    WHERE candidate.calendar_id = calendars.id
      AND candidate.weekday = EXTRACT(DOW FROM days.business_date)::smallint
      AND candidate.ordinal IN (0, ((EXTRACT(DAY FROM days.business_date)::integer - 1) / 7) + 1)
    ORDER BY candidate.ordinal DESC
    LIMIT 1
  ) rules ON rules.is_working
  JOIN nova.shifts shifts ON shifts.id = rules.shift_id
    AND shifts.organisation_id = $1 AND shifts.archived_at IS NULL
  WHERE EXISTS (SELECT 1 FROM actor_grants WHERE permission_key = 'availability.calendar.view' AND scope = 'organisation')
    AND EXISTS (SELECT 1 FROM actor_grants WHERE permission_key = 'availability.shift.view' AND scope = 'organisation')

  UNION ALL

  SELECT holidays.holiday_date::text, 'holiday'::text, holidays.id::text,
         jsonb_build_object(
           'office', jsonb_build_object('id', offices.id, 'name', offices.name),
           'timezone', offices.timezone,
           'name', holidays.name
         )
  FROM nova.office_holidays holidays
  JOIN nova.offices offices ON offices.id = holidays.office_id
    AND offices.organisation_id = $1 AND offices.archived_at IS NULL
  JOIN date_window bounds ON holidays.holiday_date BETWEEN bounds.start_date AND bounds.end_date
  WHERE holidays.organisation_id = $1
    AND EXISTS (SELECT 1 FROM actor_grants WHERE permission_key = 'availability.holiday.view' AND scope = 'organisation')

  UNION ALL

  SELECT attendance.business_date::text, 'attendance'::text, attendance.id::text,
         jsonb_build_object(
           'person', jsonb_build_object('id', people.id, 'name', COALESCE(people.display_name, 'Unnamed person')),
           'office', jsonb_build_object('id', offices.id, 'name', offices.name),
           'timezone', COALESCE(attendance.office_timezone_snapshot, offices.timezone),
           'mode', attendance.mode,
           'checkedInAt', attendance.checked_in_at,
           'checkedOutAt', attendance.checked_out_at
         )
  FROM nova.attendance_days attendance
  JOIN nova.people people ON people.id = attendance.person_id AND people.organisation_id = $1
  JOIN nova.offices offices ON offices.id = attendance.office_id AND offices.organisation_id = $1
  JOIN date_window bounds ON attendance.business_date BETWEEN bounds.start_date AND bounds.end_date
  WHERE attendance.organisation_id = $1
    AND EXISTS (
      SELECT 1 FROM actor_grants grants
      WHERE grants.permission_key = 'attendance.view'
        AND (
          grants.scope = 'organisation'
          OR (grants.scope = 'own_record' AND people.id = $2)
          OR (grants.scope = 'office' AND attendance.office_id = grants.office_id)
          OR (grants.scope = 'organisation_department' AND EXISTS (
            SELECT 1 FROM nova.person_department_assignments target_department
            WHERE target_department.person_id = people.id
              AND target_department.organisation_department_id = grants.organisation_department_id
              AND target_department.effective_on <= attendance.business_date
              AND (target_department.effective_until IS NULL OR target_department.effective_until >= attendance.business_date)
          ))
        )
    )

  UNION ALL

  SELECT days.business_date::text, 'leave'::text, days.id::text,
         jsonb_build_object(
           'requestId', requests.id,
           'person', jsonb_build_object('id', people.id, 'name', COALESCE(people.display_name, 'Unnamed person')),
           'status', requests.status,
           'leaveType', requests.leave_type,
           'portion', days.portion
         )
  FROM nova.leave_request_days days
  JOIN nova.leave_requests requests ON requests.id = days.request_id
    AND requests.organisation_id = $1
    AND requests.status IN ('requested', 'pending', 'approved')
  JOIN nova.people people ON people.id = requests.person_id AND people.organisation_id = $1
  JOIN date_window bounds ON days.business_date BETWEEN bounds.start_date AND bounds.end_date
  WHERE days.organisation_id = $1
    AND EXISTS (
      SELECT 1 FROM actor_grants grants
      WHERE (grants.permission_key = 'leave.review'
             OR (grants.permission_key = 'leave.request' AND people.id = $2))
        AND (
          grants.scope = 'organisation'
          OR (grants.scope = 'own_record' AND people.id = $2)
          OR (grants.scope = 'office' AND EXISTS (
            SELECT 1 FROM nova.person_office_assignments target_office
            WHERE target_office.person_id = people.id
              AND target_office.office_id = grants.office_id
              AND target_office.effective_on <= days.business_date
              AND (target_office.effective_until IS NULL OR target_office.effective_until >= days.business_date)
          ))
          OR (grants.scope = 'organisation_department' AND EXISTS (
            SELECT 1 FROM nova.person_department_assignments target_department
            WHERE target_department.person_id = people.id
              AND target_department.organisation_department_id = grants.organisation_department_id
              AND target_department.effective_on <= days.business_date
              AND (target_department.effective_until IS NULL OR target_department.effective_until >= days.business_date)
          ))
        )
    )

  UNION ALL

  SELECT days.business_date::text, 'wfh'::text, requests.id::text,
         jsonb_build_object(
           'requestId', requests.id,
           'person', jsonb_build_object('id', people.id, 'name', COALESCE(people.display_name, 'Unnamed person')),
           'status', requests.status
         )
  FROM nova.wfh_requests requests
  JOIN nova.people people ON people.id = requests.person_id AND people.organisation_id = $1
  JOIN date_window bounds ON requests.start_date <= bounds.end_date AND requests.end_date >= bounds.start_date
  CROSS JOIN LATERAL generate_series(
    GREATEST(requests.start_date, bounds.start_date),
    LEAST(requests.end_date, bounds.end_date), interval '1 day'
  ) days(business_date)
  WHERE requests.organisation_id = $1
    AND requests.status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1 FROM actor_grants grants
      WHERE (grants.permission_key = 'availability.wfh.review'
             OR (grants.permission_key = 'availability.wfh.request' AND people.id = $2))
        AND (
          grants.scope = 'organisation'
          OR (grants.scope = 'own_record' AND people.id = $2)
          OR (grants.scope = 'office' AND EXISTS (
            SELECT 1 FROM nova.person_office_assignments target_office
            WHERE target_office.person_id = people.id
              AND target_office.office_id = grants.office_id
              AND target_office.effective_on <= days.business_date::date
              AND (target_office.effective_until IS NULL OR target_office.effective_until >= days.business_date::date)
          ))
          OR (grants.scope = 'organisation_department' AND EXISTS (
            SELECT 1 FROM nova.person_department_assignments target_department
            WHERE target_department.person_id = people.id
              AND target_department.organisation_department_id = grants.organisation_department_id
              AND target_department.effective_on <= days.business_date::date
              AND (target_department.effective_until IS NULL OR target_department.effective_until >= days.business_date::date)
          ))
        )
    )
), agenda_page AS MATERIALIZED (
  SELECT agenda_events.event_date, agenda_events.event_kind, agenda_events.event_key, agenda_events.details
  FROM agenda_events
  CROSS JOIN access_state
  WHERE ($5::date IS NULL OR (event_date, event_kind, event_key) > ($5::text, $6::text, $7::text))
    AND ($8::text IS NULL OR $8::text = access_state.access_revision)
  ORDER BY event_date, event_kind, event_key
  LIMIT $9
)
SELECT access_state.permitted, access_state.access_revision,
       agenda_page.event_date, agenda_page.event_kind, agenda_page.event_key, agenda_page.details
FROM access_state
LEFT JOIN agenda_page ON true`;

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

export async function readAvailabilityAgenda(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const filters = parseAvailabilityAgendaFilters(request);
  if (!filters) return json({ error: "AVAILABILITY_AGENDA_QUERY_INVALID" }, 400);
  // A cursor created by an older client has no access revision. Reject it so
  // that even clients which retain pages locally clear their old projection.
  if (hasUnversionedAvailabilityCursor(filters)) {
    return json({ error: "PERMISSION_DENIED", reason: "AVAILABILITY_ACCESS_CHANGED" }, 409);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const query = await transaction.query<{
        permitted: boolean;
        access_revision: string;
        event_date: string | null;
        event_kind: string | null;
        event_key: string | null;
        details: Record<string, unknown> | null;
      }>(availabilityAgendaReadSql, [
        actor.context.organisationId,
        actor.context.userId,
        filters.startDate,
        filters.endDate,
        filters.cursorDate,
        filters.cursorKind,
        filters.cursorKey,
        filters.cursorAccessRevision,
        filters.limit + 1,
      ]);
      const snapshot = query.rows[0];
      const accessOutcome = availabilityAgendaAccessOutcome(
        filters.cursorAccessRevision,
        snapshot?.access_revision || null,
        snapshot?.permitted === true,
      );
      if (accessOutcome !== "allowed") return accessOutcome;
      return {
        accessRevision: snapshot.access_revision,
        rows: query.rows.filter((row) => row.event_date !== null && row.event_kind !== null &&
          row.event_key !== null && row.details !== null).map((row) => ({
          event_date: row.event_date as string,
          event_kind: row.event_kind as string,
          event_key: row.event_key as string,
          details: row.details as Record<string, unknown>,
        })),
      };
    });
    if (result === "revision_unavailable") {
      return json({ error: "AVAILABILITY_ACCESS_REVISION_UNAVAILABLE" }, 503);
    }
    if (result === "permission_denied") return json({ error: "PERMISSION_DENIED" }, 403);
    if (result === "access_changed") {
      return json({ error: "PERMISSION_DENIED", reason: "AVAILABILITY_ACCESS_CHANGED" }, 409);
    }
    const hasMore = result.rows.length > filters.limit;
    const rows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
    const last = rows.at(-1);
    const nextCursor = hasMore && last
      ? `${filters.startDate}~${filters.endDate}~${last.event_date}~${last.event_kind}~${last.event_key}~${result.accessRevision}`
      : null;
    return json({
      startDate: filters.startDate,
      endDate: filters.endDate,
      events: rows.map((row) => ({
        date: row.event_date,
        type: row.event_kind,
        id: row.event_key,
        ...row.details,
      })),
      hasMore,
      nextCursor,
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
