import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { idempotent, isIdempotencyReplay, requestIdempotencyKey } from "../idempotency.js";
import { enqueueNotification } from "./notifications.js";
import { lockAvailabilityDates } from "./availability-lock.js";
import { canReviewRequest } from "./review-capability.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type LeaveDayInput = Readonly<{ date: string; portion: number }>;
export type LeaveRequestInput = Readonly<{
  endDate: string;
  leaveType: string;
  reason?: string;
  startDate: string;
  days: readonly LeaveDayInput[];
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function nonEmptyString(value: unknown, maximum: number): string | undefined {
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

function dayInput(value: unknown): LeaveDayInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!validDate(candidate.date) ||
      (candidate.portion !== 0.5 && candidate.portion !== 1)) return undefined;
  return Object.freeze({ date: candidate.date, portion: candidate.portion });
}

export function leaveRequestInput(body: unknown): LeaveRequestInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const leaveType = nonEmptyString(candidate.leaveType, 80);
  const startDate = candidate.startDate;
  const endDate = candidate.endDate;
  const reason = candidate.reason === undefined || candidate.reason === null
    ? undefined
    : nonEmptyString(candidate.reason, 2000);
  if (!leaveType || !validDate(startDate) || !validDate(endDate) || startDate > endDate) return undefined;
  if (candidate.reason !== undefined && candidate.reason !== null && reason === undefined) return undefined;
  if (!Array.isArray(candidate.days) || candidate.days.length < 1 || candidate.days.length > 366) return undefined;
  if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 > 366) return undefined;
  const days = candidate.days.map(dayInput);
  if (days.some((day) => !day)) return undefined;
  const typedDays = days as LeaveDayInput[];
  const dates = new Set<string>();
  for (const day of typedDays) {
    if (dates.has(day.date) || day.date < startDate || day.date > endDate) return undefined;
    dates.add(day.date);
  }
  return Object.freeze({ leaveType, startDate, endDate, days: Object.freeze(typedDays), ...(reason ? { reason } : {}) });
}

function duplicateError(error: unknown): boolean {
  return error instanceof Error && /duplicate key|unique|exclusion|LEAVE_REQUEST_OVERLAP/i.test(error.message);
}

/** Presentation hint only. cancelLeave repeats every condition in its write transaction. */
export function canCancelLeaveRequest(
  status: string,
  endDate: string,
  businessDate: string,
  hasAttendance: boolean,
): boolean {
  return (status === "pending" || status === "requested" || status === "approved") &&
    endDate >= businessDate && hasAttendance === false;
}

/** Presentation hint only: the conflict command requires both review and recovery grants. */
export function canResolveLeaveAttendanceConflict(
  hasConflict: boolean,
  canReview: boolean,
  canRecoverAttendance: boolean,
): boolean {
  return hasConflict === true && canReview === true && canRecoverAttendance === true;
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
  try { return await request.json(); } catch { return {}; }
}

async function databaseToday(transaction: PoolClient, personId: string): Promise<string> {
  const result = await transaction.query<{ today: string }>("SELECT nova.person_business_date($1)::text AS today", [personId]);
  const today = result.rows[0]?.today;
  if (!today) throw new Error("DATABASE_DATE_RESULT_MISSING");
  return today;
}

async function hasLeavePermission(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  permissionKey: string,
  targetPersonId: string,
  effectiveDate: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM nova.person_role_assignments assignments
      JOIN nova.roles roles ON roles.id = assignments.role_id
      JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
      JOIN nova.people target ON target.id = $4 AND target.organisation_id = $3
      WHERE assignments.person_id = $1
        AND assignments.effective_on <= $5::date
        AND (assignments.effective_until IS NULL OR assignments.effective_until >= $5::date)
        AND roles.archived_at IS NULL
        AND grants.permission_key = $2
        AND (
          grants.scope = 'organisation'
          OR (grants.scope = 'own_record' AND $1 = $4)
          OR (
            grants.scope = 'office'
            AND EXISTS (
              SELECT 1 FROM nova.person_office_assignments target_office
              WHERE target_office.person_id = $4
                AND target_office.office_id = grants.office_id
                AND target_office.effective_on <= nova.person_business_date($4)
                AND (target_office.effective_until IS NULL OR target_office.effective_until >= nova.person_business_date($4))
            )
          )
          OR (
            grants.scope = 'organisation_department'
            AND EXISTS (
              SELECT 1 FROM nova.person_department_assignments target_department
              WHERE target_department.person_id = $4
                AND target_department.organisation_department_id = grants.organisation_department_id
                AND target_department.effective_on <= nova.person_business_date($4)
                AND (target_department.effective_until IS NULL OR target_department.effective_until >= nova.person_business_date($4))
            )
          )
        )
    ) AS permitted`,
    [actorId, permissionKey, organisationId, targetPersonId, effectiveDate],
  );
  return result.rows[0]?.permitted === true;
}

async function leaveRequestRow(transaction: PoolClient, requestId: string, organisationId: string) {
  return transaction.query<{
    id: string; person_id: string; leave_type: string; status: string;
    start_date: string; end_date: string; reason: string | null;
    reviewer_person_id: string | null; reviewed_at: Date | null; review_reason: string | null;
    days: unknown;
  }>(
    `SELECT requests.id, requests.person_id, requests.leave_type, requests.status,
            requests.start_date, requests.end_date, requests.reason,
            requests.reviewer_person_id, requests.reviewed_at, requests.review_reason,
            COALESCE(
              json_agg(json_build_object('date', days.business_date, 'portion', days.portion)
                ORDER BY days.business_date) FILTER (WHERE days.id IS NOT NULL), '[]'::json
            ) AS days
     FROM nova.leave_requests requests
     LEFT JOIN nova.leave_request_days days ON days.request_id = requests.id
     WHERE requests.id = $1 AND requests.organisation_id = $2
     GROUP BY requests.id`,
    [requestId, organisationId],
  );
}

function presentLeave(row: {
  id: string; person_id: string; leave_type: string; status: string;
  start_date: string; end_date: string; reason: string | null;
  reviewer_person_id: string | null; reviewed_at: Date | null; review_reason: string | null; days: unknown;
  has_conflict?: boolean;
  can_cancel?: boolean;
  can_review?: boolean;
  can_resolve_conflict?: boolean;
}) {
  const result = {
    id: row.id,
    personId: row.person_id,
    leaveType: row.leave_type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    reviewerPersonId: row.reviewer_person_id,
    reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason,
    days: row.days,
    hasConflict: row.has_conflict === true,
  };
  return {
    ...result,
    ...(typeof row.can_cancel === "boolean" ? { canCancel: row.can_cancel } : {}),
    ...(typeof row.can_review === "boolean" ? { canReview: row.can_review } : {}),
    ...(typeof row.can_resolve_conflict === "boolean" ? { canResolveConflict: row.can_resolve_conflict } : {}),
  };
}

export async function createLeaveRequest(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = leaveRequestInput(await requestBody(request));
  if (!input) return json({ error: "LEAVE_REQUEST_INPUT_INVALID" }, 400);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "leave.create", requestKey, input, async () => {
        const permissionDate = await databaseToday(transaction, actor.context.userId);
        if (input.startDate < permissionDate) return "LEAVE_PAST_DATE_REQUIRES_RECOVERY" as const;
        if (!await hasLeavePermission(transaction, actor.context.userId, actor.context.organisationId,
          "leave.request", actor.context.userId, permissionDate)) return "PERMISSION_DENIED" as const;
        const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.leave_requests (
          organisation_id, person_id, leave_type, status, start_date, end_date, reason
        ) VALUES ($1, $2, $3, 'pending', $4::date, $5::date, $6) RETURNING id`,
        [actor.context.organisationId, actor.context.userId, input.leaveType, input.startDate, input.endDate, input.reason ?? null],
        );
        const requestId = created.rows[0]?.id;
        if (!requestId) throw new Error("LEAVE_REQUEST_CREATE_RESULT_MISSING");
        for (const day of input.days) {
          await transaction.query(
          `INSERT INTO nova.leave_request_days (
            organisation_id, request_id, person_id, business_date, portion
          ) VALUES ($1, $2, $3, $4::date, $5)`,
          [actor.context.organisationId, requestId, actor.context.userId, day.date, day.portion],
          );
        }
        await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'leave.requested', 'leave_request', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, requestId,
          JSON.stringify({ leave_type: input.leaveType, start_date: input.startDate, end_date: input.endDate })],
        );
        const reviewers = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_role_assignments assignments
         JOIN nova.roles roles ON roles.id = assignments.role_id
         JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
         WHERE assignments.effective_on <= nova.person_business_date(assignments.person_id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))
           AND roles.archived_at IS NULL
           AND grants.permission_key = 'leave.review'
           AND grants.scope = 'organisation'
           AND assignments.person_id <> $1`,
        [actor.context.userId],
        );
        for (const reviewer of reviewers.rows) {
          await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: reviewer.person_id,
          eventKey: "leave.requested",
          title: "Leave request needs review",
          body: `A leave request for ${input.startDate}–${input.endDate} is waiting for review.`,
          aggregateType: "leave_request",
          aggregateId: requestId,
          deepLink: `/?view=today&leave=${requestId}`,
          idempotencyKey: `leave.requested:${requestId}:${reviewer.person_id}`,
          });
        }
        return { leaveRequestId: requestId };
      });
    });
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "LEAVE_PAST_DATE_REQUIRES_RECOVERY") return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "LEAVE_REQUEST_OVERLAP" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readLeaveMine(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const permissionDate = await databaseToday(transaction, actor.context.userId);
      if (!await hasLeavePermission(transaction, actor.context.userId, actor.context.organisationId,
        "leave.request", actor.context.userId, permissionDate)) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query(
        `SELECT requests.id, requests.person_id, requests.leave_type, requests.status,
                requests.start_date, requests.end_date::text AS end_date, requests.reason,
                requests.reviewer_person_id, requests.reviewed_at, requests.review_reason,
                EXISTS (
                  SELECT 1 FROM nova.historical_exceptions exceptions
                  WHERE exceptions.organisation_id = requests.organisation_id
                    AND exceptions.code = 'availability.leave_attendance_conflict'
                    AND exceptions.status = 'open'
                    AND exceptions.details->>'leave_request_id' = requests.id::text
                ) AS has_conflict,
                EXISTS (
                  SELECT 1
                  FROM nova.leave_request_days leave_days
                  JOIN nova.attendance_days attendance
                    ON attendance.person_id = leave_days.person_id
                   AND attendance.business_date = leave_days.business_date
                  WHERE leave_days.request_id = requests.id
                ) AS has_attendance,
                COALESCE(json_agg(json_build_object('date', days.business_date, 'portion', days.portion)
                  ORDER BY days.business_date) FILTER (WHERE days.id IS NOT NULL), '[]'::json) AS days
         FROM nova.leave_requests requests
         LEFT JOIN nova.leave_request_days days ON days.request_id = requests.id
         WHERE requests.organisation_id = $1 AND requests.person_id = $2
         GROUP BY requests.id ORDER BY requests.start_date DESC, requests.created_at DESC`,
        [actor.context.organisationId, actor.context.userId],
      );
      return rows.rows.map((row) => presentLeave({
        ...row,
        can_cancel: canCancelLeaveRequest(
          row.status,
          row.end_date,
          permissionDate,
          row.has_attendance,
        ),
      }));
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ requests: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readPendingLeaveRequests(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query(
        `SELECT requests.id, requests.person_id, requests.leave_type, requests.status,
                requests.start_date, requests.end_date, requests.reason,
                requests.reviewer_person_id, requests.reviewed_at, requests.review_reason,
                EXISTS (
                  SELECT 1 FROM nova.historical_exceptions exceptions
                  WHERE exceptions.organisation_id = requests.organisation_id
                    AND exceptions.code = 'availability.leave_attendance_conflict'
                    AND exceptions.status = 'open'
                    AND exceptions.details->>'leave_request_id' = requests.id::text
                ) AS has_conflict,
                COALESCE(json_agg(json_build_object('date', days.business_date, 'portion', days.portion)
                  ORDER BY days.business_date) FILTER (WHERE days.id IS NOT NULL), '[]'::json) AS days
         FROM nova.leave_requests requests
         LEFT JOIN nova.leave_request_days days ON days.request_id = requests.id
         WHERE requests.organisation_id = $1 AND requests.status IN ('requested', 'pending')
         GROUP BY requests.id ORDER BY requests.start_date, requests.created_at`,
        [actor.context.organisationId],
      );
      const permissionDate = await databaseToday(transaction, actor.context.userId);
      const visible = [];
      for (const row of rows.rows) {
        const permitted = await hasLeavePermission(transaction, actor.context.userId, actor.context.organisationId,
          "leave.review", row.person_id, permissionDate);
        if (permitted) {
          const canReview = canReviewRequest(actor.context.userId, row.person_id, permitted);
          const canRecoverAttendance = row.has_conflict === true && canReview && await hasLeavePermission(
            transaction,
            actor.context.userId,
            actor.context.organisationId,
            "attendance.recover",
            row.person_id,
            permissionDate,
          );
          const canResolveConflict = canResolveLeaveAttendanceConflict(
            row.has_conflict === true,
            canReview,
            canRecoverAttendance,
          );
          visible.push(presentLeave({
            ...row,
            can_review: canReview,
            can_resolve_conflict: canResolveConflict,
          }));
        }
      }
      return visible;
    });
    return json({ requests: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function reviewLeave(request: Request, requestId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const body = await requestBody(request);
  const candidate = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const decision = candidate.decision;
  const reviewReason = candidate.reason === undefined || candidate.reason === null
    ? null : nonEmptyString(candidate.reason, 2000);
  if (decision !== "approved" && decision !== "rejected") return json({ error: "LEAVE_REVIEW_INPUT_INVALID" }, 400);
  if (candidate.reason !== undefined && candidate.reason !== null && reviewReason === undefined) return json({ error: "LEAVE_REVIEW_INPUT_INVALID" }, 400);
  if (!uuidPattern.test(requestId)) return json({ error: "LEAVE_REQUEST_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const locked = await transaction.query<{
        id: string; person_id: string; status: string; start_date: string; end_date: string;
      }>(
        `SELECT id, person_id, status, start_date, end_date FROM nova.leave_requests
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [requestId, actor.context.organisationId],
      );
      const row = locked.rows[0];
      if (!row) return "LEAVE_REQUEST_NOT_FOUND" as const;
      if (row.person_id === actor.context.userId) return "SELF_REVIEW_NOT_ALLOWED" as const;
      const permissionDate = await databaseToday(transaction, actor.context.userId);
      if (!await hasLeavePermission(transaction, actor.context.userId, actor.context.organisationId,
        "leave.review", row.person_id, permissionDate)) return "PERMISSION_DENIED" as const;
      if (row.status !== "pending" && row.status !== "requested") return "LEAVE_REQUEST_NOT_PENDING" as const;
      await lockAvailabilityDates(transaction, row.person_id, row.start_date, row.end_date);
      if (decision === "approved") {
        const wfhConflict = await transaction.query(
          `SELECT 1
           FROM nova.leave_request_days days
           JOIN nova.wfh_requests wfh
             ON wfh.person_id = days.person_id
            AND wfh.start_date <= days.business_date
            AND wfh.end_date >= days.business_date
           WHERE days.request_id = $1
             AND wfh.status = 'approved'
           LIMIT 1`,
          [requestId],
        );
        if (wfhConflict.rows.length) return "LEAVE_WFH_CONFLICT" as const;
        const provisionalWfhConflict = await transaction.query(
          `SELECT 1 FROM nova.wfh_provisional_attendance evidence
           JOIN nova.leave_request_days days
             ON days.person_id = evidence.person_id
            AND days.business_date = evidence.business_date
           WHERE days.request_id = $1 AND evidence.status = 'pending'
           LIMIT 1`,
          [requestId],
        );
        if (provisionalWfhConflict.rows.length) return "LEAVE_WFH_CONFLICT" as const;
        const workConflict = await transaction.query(
          `SELECT 1
           FROM nova.leave_request_days days
           JOIN nova.work_sessions sessions
             ON sessions.person_id = days.person_id
            AND sessions.ended_at IS NULL
           WHERE days.request_id = $1
             AND days.business_date = nova.person_business_date(days.person_id)
           LIMIT 1`,
          [requestId],
        );
        if (workConflict.rows.length) return "LEAVE_WORK_CONFLICT" as const;
        const conflict = await transaction.query(
          `SELECT attendance.id, attendance.person_id, attendance.business_date
           FROM nova.leave_request_days days
           JOIN nova.attendance_days attendance
             ON attendance.person_id = days.person_id AND attendance.business_date = days.business_date
           WHERE days.request_id = $1`,
          [requestId],
        );
        if (conflict.rows.length) {
          for (const row of conflict.rows) {
            await transaction.query(
              `INSERT INTO nova.historical_exceptions (
                organisation_id, source_type, source_id, person_id, business_date, code, details
              ) VALUES ($1, 'attendance_day', $2, $3, $4::date, 'availability.leave_attendance_conflict', $5::jsonb)
              ON CONFLICT (organisation_id, source_type, source_id, code) DO NOTHING`,
              [actor.context.organisationId, row.id, row.person_id, row.business_date,
                JSON.stringify({ leave_request_id: requestId })],
            );
            await enqueueNotification(transaction, {
              organisationId: actor.context.organisationId,
              recipientPersonId: row.person_id,
              eventKey: "attendance.recovery_required",
              title: "Attendance needs review",
              body: `Leave approval created an attendance conflict for ${row.business_date}. An authorised reviewer must resolve it.`,
              aggregateType: "leave_request",
              aggregateId: requestId,
              deepLink: `/?view=today&leave=${requestId}`,
              idempotencyKey: `attendance.leave_conflict:${requestId}:${row.id}`,
            });
          }
          await transaction.query(
            `INSERT INTO nova.audit_events (
              organisation_id, actor_person_id, action, target_type, target_id, details
            ) VALUES ($1, $2, 'leave.approval_conflict', 'leave_request', $3, $4)`,
            [actor.context.organisationId, actor.context.userId, requestId,
              JSON.stringify({ reason: "attendance_exists", decision_required: true })],
          );
          return "LEAVE_ATTENDANCE_CONFLICT" as const;
        }
      }
      await transaction.query(
        `UPDATE nova.leave_requests
         SET status = $2::nova.leave_request_status,
             reviewer_person_id = $3, reviewed_at = clock_timestamp(), review_reason = $4
         WHERE id = $1`,
        [requestId, decision, actor.context.userId, reviewReason],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, $3, 'leave_request', $4, $5)`,
        [actor.context.organisationId, actor.context.userId, `leave.${decision}`, requestId,
          JSON.stringify({ reason: reviewReason })],
      );
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId,
        recipientPersonId: row.person_id,
        eventKey: decision === "approved" ? "leave.approved" : "leave.rejected",
        title: decision === "approved" ? "Leave approved" : "Leave rejected",
        body: decision === "approved"
          ? `Your leave request for ${row.start_date} was approved.`
          : `Your leave request for ${row.start_date} was rejected.${reviewReason ? ` ${reviewReason}` : ""}`,
        aggregateType: "leave_request",
        aggregateId: requestId,
        deepLink: `/?view=today&leave=${requestId}`,
        idempotencyKey: `leave.reviewed:${requestId}:${decision}`,
      });
      return { leaveRequestId: requestId, status: decision };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "SELF_REVIEW_NOT_ALLOWED") return json({ error: result }, 403);
    if (result === "LEAVE_REQUEST_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "LEAVE_REQUEST_OVERLAP" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function resolveLeaveAttendanceConflict(request: Request, requestId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(requestId)) return json({ error: "LEAVE_REQUEST_NOT_FOUND" }, 404);
  const body = await requestBody(request);
  const candidate = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const decision = candidate.decision;
  const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
  if (decision !== "approved" && decision !== "rejected" || !note || note.length > 2000) {
    return json({ error: "LEAVE_CONFLICT_DECISION_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const locked = await transaction.query<{ id: string; person_id: string; status: string; start_date: string; end_date: string }>(
        `SELECT id, person_id, status, start_date, end_date
         FROM nova.leave_requests
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [requestId, actor.context.organisationId],
      );
      const row = locked.rows[0];
      if (!row) return "LEAVE_REQUEST_NOT_FOUND" as const;
      const permissionDate = await databaseToday(transaction, actor.context.userId);
      if (row.status !== "pending" && row.status !== "requested") return "LEAVE_REQUEST_NOT_PENDING" as const;
      if (row.person_id === actor.context.userId) return "SELF_REVIEW_NOT_ALLOWED" as const;
      if (!await hasLeavePermission(transaction, actor.context.userId, actor.context.organisationId,
        "leave.review", row.person_id, permissionDate) ||
        !await hasLeavePermission(transaction, actor.context.userId, actor.context.organisationId,
          "attendance.recover", row.person_id, permissionDate)) return "PERMISSION_DENIED" as const;
      await lockAvailabilityDates(transaction, row.person_id, row.start_date, row.end_date);
      const conflicts = await transaction.query<{ id: string; person_id: string }>(
        `SELECT id, person_id FROM nova.historical_exceptions
         WHERE organisation_id = $1
           AND code = 'availability.leave_attendance_conflict'
           AND status = 'open'
           AND details->>'leave_request_id' = $2
         FOR UPDATE`,
        [actor.context.organisationId, requestId],
      );
      if (!conflicts.rows.length) return "LEAVE_CONFLICT_NOT_FOUND" as const;
      await transaction.query(
        `UPDATE nova.leave_requests
         SET status = $2::nova.leave_request_status,
             reviewer_person_id = $3, reviewed_at = clock_timestamp(), review_reason = $4
         WHERE id = $1`,
        [requestId, decision, actor.context.userId, note],
      );
      await transaction.query(
        `UPDATE nova.historical_exceptions
         SET status = 'resolved', resolved_by_person_id = $2,
             resolved_at = clock_timestamp(), resolution_note = $3
         WHERE organisation_id = $1
           AND code = 'availability.leave_attendance_conflict'
           AND status = 'open'
           AND details->>'leave_request_id' = $4`,
        [actor.context.organisationId, actor.context.userId, note, requestId],
      );
      for (const conflict of conflicts.rows) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: conflict.person_id,
          eventKey: "attendance.recovered",
          title: "Attendance conflict resolved",
          body: `The attendance conflict for leave request ${row.start_date} was resolved with attendance preserved.`,
          aggregateType: "leave_request",
          aggregateId: requestId,
          deepLink: `/?view=today&leave=${requestId}`,
          idempotencyKey: `attendance.leave_conflict_resolved:${requestId}:${conflict.id}`,
        });
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'attendance.recovered', 'leave_request', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, requestId,
          JSON.stringify({ decision, note, attendance_preserved: true, exception_count: conflicts.rows.length })],
      );
      return { leaveRequestId: requestId, status: decision, attendancePreserved: true };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "SELF_REVIEW_NOT_ALLOWED") return json({ error: result }, 403);
    if (result === "LEAVE_REQUEST_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function cancelLeave(request: Request, requestId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(requestId)) return json({ error: "LEAVE_REQUEST_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const locked = await transaction.query<{ id: string; person_id: string; status: string; start_date: string; end_date: string }>(
        `SELECT id, person_id, status, start_date, end_date::text FROM nova.leave_requests
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [requestId, actor.context.organisationId],
      );
      const row = locked.rows[0];
      if (!row) return "LEAVE_REQUEST_NOT_FOUND" as const;
      const permissionDate = await databaseToday(transaction, actor.context.userId);
      if (row.person_id !== actor.context.userId || !await hasLeavePermission(
        transaction, actor.context.userId, actor.context.organisationId,
        "leave.request", actor.context.userId, permissionDate,
      )) return "PERMISSION_DENIED" as const;
      if (row.status !== "pending" && row.status !== "requested" && row.status !== "approved") return "LEAVE_REQUEST_NOT_CANCELLABLE" as const;
      if (row.end_date < permissionDate) return "LEAVE_REQUEST_NOT_CANCELLABLE" as const;
      await lockAvailabilityDates(transaction, row.person_id, row.start_date, row.end_date);
      const attendanceConflict = await transaction.query(
        `SELECT 1
         FROM nova.leave_request_days days
         JOIN nova.attendance_days attendance
           ON attendance.person_id = days.person_id
          AND attendance.business_date = days.business_date
         WHERE days.request_id = $1
         LIMIT 1`,
        [requestId],
      );
      if (attendanceConflict.rows.length) return "LEAVE_REQUEST_NOT_CANCELLABLE" as const;
      await transaction.query(
        `UPDATE nova.leave_requests
         SET status = 'cancelled', reviewer_person_id = $2, reviewed_at = clock_timestamp()
         WHERE id = $1`,
        [requestId, actor.context.userId],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'leave.cancelled', 'leave_request', $3, '{}'::jsonb)`,
        [actor.context.organisationId, actor.context.userId, requestId],
      );
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId,
        recipientPersonId: row.person_id,
        eventKey: "leave.cancelled",
        title: "Leave cancelled",
        body: "Your leave request was cancelled.",
        aggregateType: "leave_request",
        aggregateId: requestId,
        deepLink: `/?view=today&leave=${requestId}`,
        idempotencyKey: `leave.cancelled:${requestId}`,
      });
      return { leaveRequestId: requestId, status: "cancelled" };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "LEAVE_REQUEST_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
