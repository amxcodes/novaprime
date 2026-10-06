import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { idempotent, isIdempotencyReplay, requestIdempotencyKey } from "../idempotency.js";
import { enqueueNotification } from "./notifications.js";
import { lockAvailabilityDates } from "./availability-lock.js";
import { discardWfhProvisionalEvidence } from "./wfh-provisional.js";
import { canReviewRequest } from "./review-capability.js";
import {
  cancellableWfhPredicate,
  presentWfhRequest,
  wfhMineReadSql,
  type WfhRequestReadRow,
} from "./wfh-request-read-model.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type WfhRequestInput = Readonly<{
  endDate: string;
  reason?: string;
  startDate: string;
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

export function wfhRequestInput(body: unknown): WfhRequestInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const startDate = candidate.startDate;
  const endDate = candidate.endDate;
  const reason = candidate.reason === undefined || candidate.reason === null
    ? undefined
    : nonEmptyString(candidate.reason, 2000);
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return undefined;
  if (candidate.reason !== undefined && candidate.reason !== null && reason === undefined) return undefined;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if ((end - start) / 86_400_000 > 366) return undefined;
  return Object.freeze({ startDate, endDate, ...(reason ? { reason } : {}) });
}

function duplicateError(error: unknown): boolean {
  return error instanceof Error && /duplicate key|exclusion|unique/i.test(error.message);
}

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

async function requestBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return {}; }
}

async function databaseToday(transaction: PoolClient, personId: string): Promise<string> {
  const result = await transaction.query<{ today: string }>("SELECT nova.person_business_date($1)::text AS today", [personId]);
  const today = result.rows[0]?.today;
  if (!today) throw new Error("DATABASE_DATE_RESULT_MISSING");
  return today;
}

async function hasWfhPermission(
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

async function wfhEligibility(
  transaction: PoolClient,
  organisationId: string,
  personId: string,
  startDate: string,
  endDate: string,
): Promise<{ allowed: boolean; date?: string; reason?: string }> {
  const status = await transaction.query<{ status: string }>(
    `SELECT status FROM nova.person_status_periods
     WHERE person_id = $1 AND ended_at IS NULL
     FOR KEY SHARE`,
    [personId],
  );
  if (!status.rows[0] || !["active", "notice"].includes(status.rows[0].status)) {
    return { allowed: false, reason: "PERSON_NOT_OPERATIONAL" };
  }
  const result = await transaction.query<{
    business_date: string;
    has_office: boolean;
    allowed: boolean;
  }>(
    `SELECT days.business_date::text,
            office.id IS NOT NULL AS has_office,
            COALESCE(overrides.allowed, policies.wfh_allowed, false) AS allowed
     FROM generate_series($3::date, $4::date, interval '1 day') days(business_date)
     LEFT JOIN LATERAL (
       SELECT offices.id, offices.organisation_id
       FROM nova.person_office_assignments assignments
       JOIN nova.offices offices ON offices.id = assignments.office_id
       WHERE assignments.person_id = $2
         AND assignments.effective_on <= days.business_date::date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= days.business_date::date)
         AND offices.organisation_id = $1
         AND offices.archived_at IS NULL
       ORDER BY assignments.effective_on DESC
       LIMIT 1
     ) office ON true
     LEFT JOIN LATERAL (
       SELECT policies.wfh_allowed
       FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_operational_policies policies ON policies.role_id = roles.id
       WHERE assignments.person_id = $2
         AND assignments.effective_on <= days.business_date::date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= days.business_date::date)
         AND roles.archived_at IS NULL
       ORDER BY assignments.effective_on DESC
       LIMIT 1
     ) policies ON true
     LEFT JOIN LATERAL (
       SELECT policy.allowed
       FROM nova.wfh_policy_overrides policy
       WHERE policy.organisation_id = $1
         AND policy.effective_on <= days.business_date::date
         AND (policy.effective_until IS NULL OR policy.effective_until >= days.business_date::date)
         AND (
           (policy.target_type = 'person' AND policy.target_id = $2)
           OR (policy.target_type = 'office' AND policy.target_id = office.id)
           OR (
             policy.target_type = 'organisation_department'
             AND EXISTS (
               SELECT 1 FROM nova.person_department_assignments departments
               WHERE departments.person_id = $2
                 AND departments.organisation_department_id = policy.target_id
                 AND departments.effective_on <= days.business_date::date
                 AND (departments.effective_until IS NULL OR departments.effective_until >= days.business_date::date)
             )
           )
         )
       ORDER BY CASE policy.target_type
         WHEN 'person' THEN 1
         WHEN 'organisation_department' THEN 2
         ELSE 3
       END
       LIMIT 1
     ) overrides ON true
     ORDER BY days.business_date`,
    [organisationId, personId, startDate, endDate],
  );
  for (const row of result.rows) {
    if (!row.has_office) return { allowed: false, date: row.business_date, reason: "OFFICE_ASSIGNMENT_REQUIRED" };
    if (!row.allowed) return { allowed: false, date: row.business_date, reason: "WFH_NOT_ALLOWED" };
  }
  const leaveConflict = await transaction.query(
    `SELECT 1
     FROM nova.leave_request_days days
     JOIN nova.leave_requests requests ON requests.id = days.request_id
     WHERE days.person_id = $1
       AND days.business_date BETWEEN $2::date AND $3::date
       AND requests.status = 'approved'
     LIMIT 1`,
    [personId, startDate, endDate],
  );
  if (leaveConflict.rows.length > 0) {
    return { allowed: false, reason: "LEAVE_WFH_CONFLICT" };
  }
  return { allowed: true };
}

export async function createWfhRequest(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = wfhRequestInput(await requestBody(request));
  if (!input) return json({ error: "WFH_REQUEST_INPUT_INVALID" }, 400);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "wfh.create", requestKey, input, async () => {
        const today = await databaseToday(transaction, actor.context.userId);
        if (input.startDate < today) return "WFH_PAST_DATE_REQUIRES_RECOVERY" as const;
        if (!await hasWfhPermission(transaction, actor.context.userId, actor.context.organisationId,
          "availability.wfh.request", actor.context.userId, today)) return "PERMISSION_DENIED" as const;
        await lockAvailabilityDates(transaction, actor.context.userId, input.startDate, input.endDate);
        const eligibility = await wfhEligibility(transaction, actor.context.organisationId,
          actor.context.userId, input.startDate, input.endDate);
        if (!eligibility.allowed) {
          if (eligibility.reason === "OFFICE_ASSIGNMENT_REQUIRED") return "OFFICE_ASSIGNMENT_REQUIRED" as const;
          if (eligibility.reason === "LEAVE_WFH_CONFLICT") return "LEAVE_WFH_CONFLICT" as const;
          return "WFH_NOT_ALLOWED" as const;
        }
        const attendance = await transaction.query(
          `SELECT 1 FROM nova.attendance_days
           WHERE person_id = $1 AND business_date BETWEEN $2::date AND $3::date
           LIMIT 1`,
          [actor.context.userId, input.startDate, input.endDate],
        );
        if (attendance.rows[0]) return "WFH_ATTENDANCE_CONFLICT" as const;
        const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.wfh_requests (
          organisation_id, person_id, start_date, end_date, reason
        ) VALUES ($1, $2, $3::date, $4::date, $5)
        RETURNING id`,
        [actor.context.organisationId, actor.context.userId, input.startDate, input.endDate, input.reason ?? null],
        );
        const id = created.rows[0]?.id;
        if (!id) throw new Error("WFH_REQUEST_CREATE_RESULT_MISSING");
        await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.wfh_requested', 'wfh_request', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, id,
          JSON.stringify({ start_date: input.startDate, end_date: input.endDate })],
        );
        const reviewers = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_role_assignments assignments
         JOIN nova.roles roles ON roles.id = assignments.role_id
         JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
         WHERE assignments.effective_on <= nova.person_business_date(assignments.person_id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))
           AND roles.archived_at IS NULL
           AND grants.permission_key = 'availability.wfh.review'
           AND grants.scope = 'organisation'
           AND assignments.person_id <> $1`,
        [actor.context.userId],
        );
        for (const reviewer of reviewers.rows) {
          await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: reviewer.person_id,
          eventKey: "wfh.requested",
          title: "WFH request needs review",
          body: `A WFH request for ${input.startDate}–${input.endDate} is waiting for review.`,
          aggregateType: "wfh_request",
          aggregateId: id,
          deepLink: `/?view=today&wfh=${id}`,
          idempotencyKey: `wfh.requested:${id}:${reviewer.person_id}`,
          });
        }
        return { wfhRequestId: id };
      });
    });
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "WFH_PAST_DATE_REQUIRES_RECOVERY") return json({ error: result }, 409);
    if (result === "OFFICE_ASSIGNMENT_REQUIRED" || result === "WFH_NOT_ALLOWED" || result === "LEAVE_WFH_CONFLICT" || result === "WFH_ATTENDANCE_CONFLICT") return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "WFH_REQUEST_OVERLAP" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readWfhMine(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const today = await databaseToday(transaction, actor.context.userId);
      if (!await hasWfhPermission(transaction, actor.context.userId, actor.context.organisationId,
        "availability.wfh.request", actor.context.userId, today)) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query<WfhRequestReadRow>(
        wfhMineReadSql,
        [actor.context.organisationId, actor.context.userId, today],
      );
      return rows.rows.map(presentWfhRequest);
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ requests: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readPendingWfhRequests(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const today = await databaseToday(transaction, actor.context.userId);
      const rows = await transaction.query(
        `SELECT id, person_id, start_date, end_date, reason, status,
                reviewer_person_id, reviewed_at, review_reason
         FROM nova.wfh_requests
         WHERE organisation_id = $1 AND status = 'pending'
         ORDER BY start_date, created_at`,
        [actor.context.organisationId],
      );
      const visible = [];
      for (const row of rows.rows) {
        const permitted = await hasWfhPermission(transaction, actor.context.userId, actor.context.organisationId,
          "availability.wfh.review", row.person_id, today);
        if (permitted) visible.push(presentWfhRequest({
          ...row,
          can_review: canReviewRequest(actor.context.userId, row.person_id, permitted),
        }));
      }
      return visible;
    });
    return json({ requests: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function reviewWfhRequest(request: Request, requestId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(requestId)) return json({ error: "WFH_REQUEST_NOT_FOUND" }, 404);
  const body = await requestBody(request);
  const candidate = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const decision = candidate.decision;
  const reason = candidate.reason === undefined || candidate.reason === null
    ? null : nonEmptyString(candidate.reason, 2000);
  if (decision !== "approved" && decision !== "rejected") return json({ error: "WFH_REVIEW_INPUT_INVALID" }, 400);
  if (candidate.reason !== undefined && candidate.reason !== null && reason === undefined) return json({ error: "WFH_REVIEW_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const initial = await transaction.query<{
        id: string; person_id: string; start_date: string; end_date: string; status: string;
      }>(
        `SELECT id, person_id, start_date, end_date, status
         FROM nova.wfh_requests
         WHERE id = $1 AND organisation_id = $2`,
        [requestId, actor.context.organisationId],
      );
      const initialRow = initial.rows[0];
      if (!initialRow) return "WFH_REQUEST_NOT_FOUND" as const;
      if (initialRow.person_id === actor.context.userId) return "SELF_REVIEW_NOT_ALLOWED" as const;
      await lockAvailabilityDates(transaction, initialRow.person_id, initialRow.start_date, initialRow.end_date);
      const locked = await transaction.query<{
        id: string; person_id: string; start_date: string; end_date: string; status: string;
      }>(
        `SELECT id, person_id, start_date, end_date, status
         FROM nova.wfh_requests
         WHERE id = $1 AND organisation_id = $2
         FOR UPDATE`,
        [requestId, actor.context.organisationId],
      );
      const row = locked.rows[0];
      if (!row) return "WFH_REQUEST_NOT_FOUND" as const;
      if (row.person_id === actor.context.userId) return "SELF_REVIEW_NOT_ALLOWED" as const;
      const today = await databaseToday(transaction, actor.context.userId);
      if (!await hasWfhPermission(transaction, actor.context.userId, actor.context.organisationId,
        "availability.wfh.review", row.person_id, today)) return "PERMISSION_DENIED" as const;
      if (row.status !== "pending") return "WFH_REQUEST_NOT_PENDING" as const;
      if (decision === "approved") {
        const eligibility = await wfhEligibility(transaction, actor.context.organisationId,
          row.person_id, row.start_date, row.end_date);
        if (!eligibility.allowed) {
          if (eligibility.reason === "OFFICE_ASSIGNMENT_REQUIRED") return "OFFICE_ASSIGNMENT_REQUIRED" as const;
          if (eligibility.reason === "LEAVE_WFH_CONFLICT") return "LEAVE_WFH_CONFLICT" as const;
          return "WFH_NOT_ALLOWED" as const;
        }
        const attendance = await transaction.query(
          `SELECT 1 FROM nova.attendance_days
           WHERE person_id = $1 AND business_date BETWEEN $2::date AND $3::date
           LIMIT 1`,
          [row.person_id, row.start_date, row.end_date],
        );
        if (attendance.rows[0]) return "WFH_ATTENDANCE_CONFLICT" as const;
      }
      let reviewedAt: string;
      if (decision === "rejected") {
        reviewedAt = (await discardWfhProvisionalEvidence(
          transaction,
          { requestId },
          "WFH_REQUEST_REJECTED",
        )).resolvedAt;
      } else {
        const clock = await transaction.query<{ reviewed_at: string }>(
          `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS reviewed_at`,
        );
        reviewedAt = clock.rows[0]?.reviewed_at ?? "";
        if (!reviewedAt) throw new Error("WFH_REVIEW_CLOCK_MISSING");
        await transaction.query(
          `WITH created AS (
             INSERT INTO nova.attendance_days (
               organisation_id, person_id, office_id, business_date, mode,
               checked_in_at, checked_out_at, closure_reason, office_timezone_snapshot
             )
             SELECT evidence.organisation_id, evidence.person_id, evidence.office_id,
                    evidence.business_date, 'wfh'::nova.attendance_mode,
                    evidence.checked_in_at, evidence.checked_out_at,
                    CASE WHEN evidence.checked_out_at IS NULL THEN NULL ELSE 'WFH_PROVISIONAL_PROMOTED' END,
                    evidence.office_timezone_snapshot
             FROM nova.wfh_provisional_attendance evidence
             WHERE evidence.request_id = $1 AND evidence.status = 'pending'
             RETURNING id, organisation_id, person_id, business_date
           )
           UPDATE nova.wfh_provisional_attendance evidence
           SET status = 'promoted', resolved_at = $2::timestamptz,
               attendance_day_id = created.id
           FROM created
           WHERE evidence.organisation_id = created.organisation_id
             AND evidence.person_id = created.person_id
             AND evidence.business_date = created.business_date
             AND evidence.request_id = $1
             AND evidence.status = 'pending'`,
          [requestId, reviewedAt],
        );
      }
      await transaction.query(
        `UPDATE nova.wfh_requests
         SET status = $2::nova.wfh_request_status,
             reviewer_person_id = $3, reviewed_at = $5::timestamptz, review_reason = $4
         WHERE id = $1`,
        [requestId, decision, actor.context.userId, reason, reviewedAt],
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, $3, 'wfh_request', $4, $5)`,
        [actor.context.organisationId, actor.context.userId, `availability.wfh_${decision}`, requestId,
          JSON.stringify({ reason })],
      );
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId,
        recipientPersonId: row.person_id,
        eventKey: decision === "approved" ? "wfh.approved" : "wfh.rejected",
        title: decision === "approved" ? "WFH request approved" : "WFH request rejected",
        body: decision === "approved"
          ? `Your WFH request for ${row.start_date}–${row.end_date} was approved.`
          : `Your WFH request for ${row.start_date}–${row.end_date} was rejected.${reason ? ` ${reason}` : ""}`,
        aggregateType: "wfh_request",
        aggregateId: requestId,
        deepLink: `/?view=today&wfh=${requestId}`,
        idempotencyKey: `wfh.reviewed:${requestId}:${decision}`,
      });
      return { wfhRequestId: requestId, status: decision };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "SELF_REVIEW_NOT_ALLOWED") return json({ error: result }, 403);
    if (result === "WFH_REQUEST_NOT_FOUND") return json({ error: result }, 404);
    if (result === "WFH_ATTENDANCE_CONFLICT") return json({ error: result }, 409);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "WFH_REQUEST_OVERLAP" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function cancelWfhRequest(request: Request, requestId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(requestId)) return json({ error: "WFH_REQUEST_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const today = await databaseToday(transaction, actor.context.userId);
      if (!await hasWfhPermission(transaction, actor.context.userId, actor.context.organisationId,
        "availability.wfh.request", actor.context.userId, today)) return "PERMISSION_DENIED" as const;
      const initial = await transaction.query<{
        person_id: string; start_date: string; end_date: string;
      }>(
        `SELECT person_id, start_date, end_date
         FROM nova.wfh_requests
         WHERE id = $1 AND organisation_id = $2 AND person_id = $3`,
        [requestId, actor.context.organisationId, actor.context.userId],
      );
      const initialRow = initial.rows[0];
      if (!initialRow) return "WFH_REQUEST_NOT_CANCELLABLE" as const;
      await lockAvailabilityDates(transaction, initialRow.person_id, initialRow.start_date, initialRow.end_date);
      const existing = await transaction.query<{
        person_id: string; start_date: string; end_date: string;
      }>(
        `SELECT person_id, start_date, end_date
         FROM nova.wfh_requests
         WHERE id = $1 AND organisation_id = $2 AND person_id = $3
         FOR UPDATE`,
        [requestId, actor.context.organisationId, actor.context.userId],
      );
      const requestRow = existing.rows[0];
      if (!requestRow) return "WFH_REQUEST_NOT_CANCELLABLE" as const;
      const clock = await transaction.query<{ reviewed_at: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS reviewed_at`,
      );
      const reviewedAt = clock.rows[0]?.reviewed_at;
      if (!reviewedAt) throw new Error("WFH_CANCEL_CLOCK_MISSING");
      const updated = await transaction.query<{ id: string }>(
        `UPDATE nova.wfh_requests AS requests
         SET status = 'cancelled', reviewer_person_id = $2, reviewed_at = $5::timestamptz
         WHERE requests.id = $1 AND requests.organisation_id = $3 AND requests.person_id = $2
           AND (${cancellableWfhPredicate("requests", "$4")})
         RETURNING requests.id`,
         [requestId, actor.context.userId, actor.context.organisationId, today, reviewedAt],
      );
      if (!updated.rows[0]) return "WFH_REQUEST_NOT_CANCELLABLE" as const;
      await discardWfhProvisionalEvidence(
        transaction,
        { requestId },
        "WFH_REQUEST_CANCELLED",
        reviewedAt,
      );
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.wfh_cancelled', 'wfh_request', $3, '{}'::jsonb)`,
        [actor.context.organisationId, actor.context.userId, requestId],
      );
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId,
        recipientPersonId: actor.context.userId,
        eventKey: "wfh.cancelled",
        title: "WFH request cancelled",
        body: "Your WFH request was cancelled.",
        aggregateType: "wfh_request",
        aggregateId: requestId,
        deepLink: `/?view=today&wfh=${requestId}`,
        idempotencyKey: `wfh.cancelled:${requestId}`,
      });
      return { wfhRequestId: requestId, status: "cancelled" };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "WFH_REQUEST_NOT_CANCELLABLE") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function approvedWfhOnDate(
  transaction: PoolClient,
  personId: string,
  businessDate: string,
): Promise<boolean> {
  const result = await transaction.query(
    `SELECT 1 FROM nova.wfh_requests
     WHERE person_id = $1 AND status = 'approved'
       AND start_date <= $2::date AND end_date >= $2::date
     LIMIT 1`,
    [personId, businessDate],
  );
  return result.rows.length > 0;
}
