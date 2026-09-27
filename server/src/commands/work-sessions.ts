import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { lockAvailabilityDates } from "./availability-lock.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AssignmentRow = Readonly<{
  id: string;
  person_id: string;
  assignment_status: string;
  task_status: string;
  task_id: string;
  client_workstream_id: string | null;
  work_group_id: string | null;
  title: string;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

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

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
}

async function hasStartPermission(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  assignment: AssignmentRow,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments actor_roles
       JOIN nova.roles roles ON roles.id = actor_roles.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE actor_roles.person_id = $1
         AND actor_roles.effective_on <= nova.person_business_date($1)
         AND (actor_roles.effective_until IS NULL OR actor_roles.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL
         AND grants.permission_key = 'tasks.start'
         AND (
           grants.scope = 'organisation'
           OR (grants.scope = 'assigned_work' AND EXISTS (
             SELECT 1 FROM nova.task_assignments own_assignment
             WHERE own_assignment.id = $2
               AND own_assignment.person_id = $1
               AND own_assignment.organisation_id = $3
           ))
         )
     ) AS permitted`,
    [actorId, assignment.id, organisationId],
  );
  return result.rows[0]?.permitted === true;
}

async function workEnabled(transaction: PoolClient, actorId: string): Promise<boolean> {
  const result = await transaction.query<{ enabled: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments assignments
       JOIN nova.role_operational_policies policies ON policies.role_id = assignments.role_id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND policies.work_enabled
     ) AS enabled`,
    [actorId],
  );
  return result.rows[0]?.enabled === true;
}

async function attendanceSatisfied(
  transaction: PoolClient,
  actorId: string,
  businessDate: string,
): Promise<{ satisfied: boolean; provisionalEvidenceId?: string }> {
  const required = await transaction.query<{ required: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM nova.person_role_assignments assignments
       JOIN nova.role_operational_policies policies ON policies.role_id = assignments.role_id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND policies.attendance_required
     ) AS required`,
    [actorId],
  );
  if (required.rows[0]?.required !== true) return { satisfied: true };
  const openAttendance = await transaction.query(
    `SELECT 1 FROM nova.attendance_days
     WHERE person_id = $1
       AND business_date = nova.person_business_date($1)
       AND checked_in_at IS NOT NULL
       AND checked_out_at IS NULL
     LIMIT 1`,
    [actorId],
  );
  if (openAttendance.rows[0]) return { satisfied: true };
  const provisional = await transaction.query<{ id: string }>(
    `SELECT evidence.id
     FROM nova.wfh_provisional_attendance evidence
     JOIN nova.wfh_requests requests ON requests.id = evidence.request_id
     WHERE evidence.person_id = $1
       AND evidence.business_date = $2::date
       AND evidence.status = 'pending'
       AND evidence.checked_out_at IS NULL
       AND clock_timestamp() < ((evidence.business_date + 1)::timestamp
         AT TIME ZONE evidence.office_timezone_snapshot)
       AND requests.status = 'pending'
     LIMIT 1
     FOR UPDATE OF evidence`,
    [actorId, businessDate],
  );
  const evidenceId = provisional.rows[0]?.id;
  return evidenceId ? { satisfied: true, provisionalEvidenceId: evidenceId } : { satisfied: false };
}

async function approvedLeaveToday(transaction: PoolClient, actorId: string): Promise<boolean> {
  const result = await transaction.query(
    `SELECT 1 FROM nova.leave_request_days days
     JOIN nova.leave_requests requests ON requests.id = days.request_id
     WHERE days.person_id = $1
       AND days.business_date = nova.person_business_date($1)
       AND requests.status = 'approved'
     LIMIT 1`,
    [actorId],
  );
  return result.rows.length > 0;
}

async function assignment(
  transaction: PoolClient,
  assignmentId: string,
  organisationId: string,
  forUpdate = false,
): Promise<AssignmentRow | undefined> {
  const result = await transaction.query<AssignmentRow>(
    `SELECT assignments.id, assignments.person_id, assignments.status AS assignment_status,
            tasks.status AS task_status, tasks.id AS task_id,
            tasks.client_workstream_id, tasks.work_group_id, tasks.title
     FROM nova.task_assignments assignments
     JOIN nova.tasks tasks ON tasks.id = assignments.task_id
     WHERE assignments.id = $1 AND assignments.organisation_id = $2
     ${forUpdate ? "FOR UPDATE OF assignments, tasks" : ""}`,
    [assignmentId, organisationId],
  );
  return result.rows[0];
}

async function startSession(
  context: DatabaseRequestContext,
  assignmentId: string,
): Promise<string | "PERMISSION_DENIED" | "ASSIGNMENT_NOT_FOUND" | "WORK_NOT_ENABLED" | "ATTENDANCE_REQUIRED" | "WORK_ON_APPROVED_LEAVE" | "ASSIGNMENT_NOT_STARTABLE" | "SESSION_ALREADY_RUNNING" | "OFFICE_ASSIGNMENT_REQUIRED"> {
  return withDatabaseRequest(context, async (transaction) => {
    const dateResult = await transaction.query<{ business_date: string }>(
      "SELECT nova.person_business_date($1)::text AS business_date", [context.userId],
    );
    const businessDate = dateResult.rows[0]?.business_date;
    if (!businessDate) throw new Error("BUSINESS_DATE_MISSING");
    await lockAvailabilityDates(transaction, context.userId, businessDate, businessDate);
    const lifecycle = await transaction.query<{ status: string }>(
      `SELECT status FROM nova.person_status_periods
       WHERE person_id = $1 AND ended_at IS NULL FOR UPDATE`,
      [context.userId],
    );
    if (!lifecycle.rows[0] || !["active", "notice"].includes(lifecycle.rows[0].status)) return "PERMISSION_DENIED";
    const row = await assignment(transaction, assignmentId, context.organisationId, true);
    if (!row) return "ASSIGNMENT_NOT_FOUND";
    if (row.person_id !== context.userId) return "PERMISSION_DENIED";
    if (!await hasStartPermission(transaction, context.userId, context.organisationId, row)) return "PERMISSION_DENIED";
    if (!await workEnabled(transaction, context.userId)) return "WORK_NOT_ENABLED";
    if (await approvedLeaveToday(transaction, context.userId)) return "WORK_ON_APPROVED_LEAVE";
    if (!["assigned", "in_progress", "changes_requested"].includes(row.assignment_status) ||
      !["backlog", "ready", "in_progress", "returned", "blocked"].includes(row.task_status)) {
      return "ASSIGNMENT_NOT_STARTABLE";
    }
    const attendance = await attendanceSatisfied(transaction, context.userId, businessDate);
    if (!attendance.satisfied) return "ATTENDANCE_REQUIRED";
    const office = await transaction.query<{ office_id: string; timezone: string }>(
      `SELECT assignments.office_id, offices.timezone
       FROM nova.person_office_assignments assignments
       JOIN nova.offices offices ON offices.id = assignments.office_id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= $2::date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
         AND offices.archived_at IS NULL
       ORDER BY assignments.effective_on DESC
       LIMIT 1`,
      [context.userId, businessDate],
    );
    const officeId = office.rows[0]?.office_id;
    if (!officeId) return "OFFICE_ASSIGNMENT_REQUIRED";
    const running = await transaction.query(
      "SELECT 1 FROM nova.work_sessions WHERE person_id = $1 AND ended_at IS NULL FOR UPDATE",
      [context.userId],
    );
    if (running.rows[0]) return "SESSION_ALREADY_RUNNING";
    const created = await transaction.query<{ id: string }>(
      `INSERT INTO nova.work_sessions (
         organisation_id, assignment_id, person_id, office_id,
         office_timezone_snapshot, provisional_wfh_attendance_id
       ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [context.organisationId, assignmentId, context.userId, officeId,
        office.rows[0]?.timezone, attendance.provisionalEvidenceId ?? null],
    );
    const sessionId = created.rows[0]?.id;
    if (!sessionId) throw new Error("WORK_SESSION_CREATE_RESULT_MISSING");
    await transaction.query(
      `UPDATE nova.task_assignments SET status = 'in_progress'
       WHERE id = $1 AND status IN ('assigned', 'changes_requested')`,
      [assignmentId],
    );
    await transaction.query(
      `UPDATE nova.tasks SET status = 'in_progress'
       WHERE id = $1 AND status IN ('backlog', 'ready', 'returned')`,
      [row.task_id],
    );
    await transaction.query(
      `INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES ($1, $2, 'work.session.started', 'work_session', $3, $4)`,
      [context.organisationId, context.userId, sessionId, JSON.stringify({ assignment_id: assignmentId, task_id: row.task_id })],
    );
    return sessionId;
  });
}

export async function startWorkSession(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const value = await requestBody(request);
  const assignmentId = value.assignmentId;
  if (typeof assignmentId !== "string" || !uuidPattern.test(assignmentId)) return json({ error: "WORK_SESSION_INPUT_INVALID" }, 400);
  try {
    const result = await startSession(actor.context, assignmentId);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (["WORK_NOT_ENABLED", "ATTENDANCE_REQUIRED", "WORK_ON_APPROVED_LEAVE", "ASSIGNMENT_NOT_STARTABLE", "SESSION_ALREADY_RUNNING", "OFFICE_ASSIGNMENT_REQUIRED"].includes(result)) return json({ error: result }, 409);
    return json({ sessionId: result }, 201);
  } catch (error) {
    if (error instanceof Error && /exclusion|unique/i.test(error.message)) return json({ error: "SESSION_ALREADY_RUNNING" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

async function closeSession(
  context: DatabaseRequestContext,
  sessionId: string,
  reason: "PAUSED" | "STOPPED",
): Promise<string | "SESSION_NOT_FOUND" | "PERMISSION_DENIED" | "SESSION_NOT_RUNNING"> {
  return withDatabaseRequest(context, async (transaction) => {
    const date = await transaction.query<{ business_date: string }>(
      `SELECT (sessions.started_at AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone))::date::text AS business_date
       FROM nova.work_sessions sessions
       LEFT JOIN nova.offices offices ON offices.id = sessions.office_id
       WHERE sessions.id = $1 AND sessions.organisation_id = $2 AND sessions.person_id = $3`,
      [sessionId, context.organisationId, context.userId],
    );
    const businessDate = date.rows[0]?.business_date;
    if (!businessDate) return "SESSION_NOT_FOUND";
    await lockAvailabilityDates(transaction, context.userId, businessDate, businessDate);
    const result = await transaction.query<{ id: string; assignment_id: string; task_id: string; client_workstream_id: string | null; work_group_id: string | null }>(
      `SELECT sessions.id, sessions.assignment_id, assignments.person_id,
              assignments.task_id, tasks.client_workstream_id, tasks.work_group_id
       FROM nova.work_sessions sessions
       JOIN nova.task_assignments assignments ON assignments.id = sessions.assignment_id
       JOIN nova.tasks tasks ON tasks.id = assignments.task_id
       WHERE sessions.id = $1 AND sessions.organisation_id = $2 AND sessions.person_id = $3
       FOR UPDATE`,
      [sessionId, context.organisationId, context.userId],
    );
    const session = result.rows[0];
    if (!session) return "SESSION_NOT_FOUND";
    // Revoking start permission must stop future work, not trap the owner in a running timer.
    const updated = await transaction.query<{ id: string }>(
      `UPDATE nova.work_sessions AS sessions
       SET ended_at = GREATEST(
         LEAST(
           clock_timestamp(),
           COALESCE(
             (
             SELECT ((sessions.started_at AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone))::date + 1)::timestamp
                 AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone)
               FROM nova.offices offices
               WHERE offices.id = sessions.office_id
             ),
             clock_timestamp()
           )
         ),
         started_at + interval '1 microsecond'
       ),
           state = 'completed', closure_reason = $2
       WHERE sessions.id = $1 AND sessions.ended_at IS NULL
       RETURNING id`,
      [sessionId, reason],
    );
    if (!updated.rows[0]) return "SESSION_NOT_RUNNING";
    await transaction.query(
      `INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES ($1, $2, 'work.session.closed', 'work_session', $3, $4)`,
      [context.organisationId, context.userId, sessionId, JSON.stringify({ reason, assignment_id: session.assignment_id })],
    );
    return sessionId;
  });
}

export async function closeWorkSession(request: Request, sessionId: string, reason: "PAUSED" | "STOPPED"): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(sessionId)) return json({ error: "SESSION_NOT_FOUND" }, 404);
  try {
    const result = await closeSession(actor.context, sessionId, reason);
    if (result === "SESSION_NOT_FOUND") return json({ error: result }, 404);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "SESSION_NOT_RUNNING") return json({ error: result }, 409);
    return json({ sessionId: result, closed: true, reason });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readWorkSessions(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const rows = await withDatabaseRequest(actor.context, async (transaction) => (await transaction.query(
      `SELECT sessions.id, sessions.assignment_id, sessions.started_at, sessions.ended_at,
              sessions.state, sessions.closure_reason, tasks.id AS task_id, tasks.title,
              round(EXTRACT(EPOCH FROM (
                COALESCE(
                  LEAST(
                    COALESCE(sessions.ended_at, clock_timestamp()),
                    ((sessions.started_at AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone))::date + 1)::timestamp
                      AT TIME ZONE COALESCE(sessions.office_timezone_snapshot, offices.timezone)
                  ),
                  COALESCE(sessions.ended_at, clock_timestamp())
                ) - sessions.started_at
              )) * 1000000)::bigint AS duration_microseconds
       FROM nova.work_sessions sessions
       JOIN nova.task_assignments assignments ON assignments.id = sessions.assignment_id
       JOIN nova.tasks tasks ON tasks.id = assignments.task_id
       LEFT JOIN nova.offices offices ON offices.id = sessions.office_id
       WHERE sessions.organisation_id = $1 AND sessions.person_id = $2
         AND sessions.started_at >= clock_timestamp() - interval '31 days'
       ORDER BY sessions.started_at DESC`,
      [actor.context.organisationId, actor.context.userId],
    )).rows);
    return json({ sessions: rows.map((row) => ({
      id: row.id, assignmentId: row.assignment_id, taskId: row.task_id, title: row.title,
      startedAt: row.started_at, endedAt: row.ended_at, state: row.state, closureReason: row.closure_reason,
      durationMicroseconds: Number(row.duration_microseconds ?? 0),
      durationMilliseconds: Math.floor(Number(row.duration_microseconds ?? 0) / 1000),
    })) });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
