import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { timestampInput } from "../timestamp-input.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function actor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); } catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const value = await requestActor(request);
  if (!value) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(value)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: value.context };
}

async function canAdjust(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  targetPersonId: string,
  assignmentId: string,
): Promise<boolean> {
  const result = await transaction.query<{ allowed: boolean }>(
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
             FROM nova.task_assignments target_assignments
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             JOIN nova.client_workstreams target_workstreams ON target_workstreams.id = target_tasks.client_workstream_id
             WHERE target_assignments.id = $4
               AND target_assignments.organisation_id = $5
               AND target_assignments.person_id = $3
               AND target_workstreams.client_id = grants.client_id
           ))
           OR (grants.scope = 'client_workstream' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments target_assignments
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             WHERE target_assignments.id = $4
               AND target_assignments.organisation_id = $5
               AND target_assignments.person_id = $3
               AND target_tasks.client_workstream_id = grants.client_workstream_id
           ))
           OR (grants.scope = 'group' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments target_assignments
             JOIN nova.tasks target_tasks ON target_tasks.id = target_assignments.task_id
             WHERE target_assignments.id = $4
               AND target_assignments.organisation_id = $5
               AND target_assignments.person_id = $3
               AND target_tasks.work_group_id = grants.group_id
           ))
           OR (grants.scope = 'assigned_work' AND EXISTS (
             SELECT 1
             FROM nova.task_assignments target_assignments
             JOIN nova.task_assignments actor_assignments ON actor_assignments.task_id = target_assignments.task_id
             WHERE target_assignments.id = $4
               AND target_assignments.organisation_id = $5
               AND target_assignments.person_id = $3
               AND actor_assignments.organisation_id = $5
               AND actor_assignments.person_id = $1
           ))
         )
     ) AS allowed`,
    [actorId, targetPersonId === actorId ? "work.timeline_adjust_own" : "work.timeline_adjust_others", targetPersonId, assignmentId, organisationId],
  );
  return result.rows[0]?.allowed === true;
}

export async function createTimelineAdjustment(request: Request): Promise<Response> {
  const access = await actor(request);
  if ("response" in access) return access.response;
  const value = await request.json().catch(() => ({}));
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const targetPersonId = input.personId === undefined ? undefined : (typeof input.personId === "string" && uuidPattern.test(input.personId) ? input.personId : null);
  const startedAt = timestampInput(input.startedAt);
  const endedAt = timestampInput(input.endedAt);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const assignmentId = typeof input.assignmentId === "string" && uuidPattern.test(input.assignmentId) ? input.assignmentId : undefined;
  if (!startedAt || !endedAt ||
    !reason || reason.length > 2000 || !assignmentId || targetPersonId === null) {
    return json({ error: "TIMELINE_ADJUSTMENT_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(access.context, async (transaction) => {
      const temporal = await transaction.query<{ valid: boolean }>(
        `WITH db_clock AS (SELECT clock_timestamp() AS at)
         SELECT $1::timestamptz < $2::timestamptz
           AND $2::timestamptz <= db_clock.at
           AND $1::timestamptz >= db_clock.at - interval '31 days' AS valid
         FROM db_clock`,
        [startedAt, endedAt],
      );
      if (temporal.rows[0]?.valid !== true) return "TIMELINE_ADJUSTMENT_INPUT_INVALID" as const;
      const targetId = targetPersonId ?? access.context.userId;
      await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [targetId]);
      if (!await canAdjust(transaction, access.context.userId, access.context.organisationId, targetId, assignmentId)) return "PERMISSION_DENIED" as const;
      const target = await transaction.query<{ id: string; status: string }>(
        `SELECT people.id, periods.status
         FROM nova.people
         JOIN nova.person_status_periods periods ON periods.person_id = people.id AND periods.ended_at IS NULL
         WHERE people.id = $1 AND people.organisation_id = $2`,
        [targetId, access.context.organisationId],
      );
      if (!target.rows[0]) return "TARGET_NOT_FOUND" as const;
      if (!["active", "notice"].includes(target.rows[0].status)) return "TARGET_NOT_OPERATIONAL" as const;
      const assignment = await transaction.query<{ id: string }>(
        `SELECT assignments.id
         FROM nova.task_assignments assignments
         JOIN nova.tasks tasks ON tasks.id = assignments.task_id
         WHERE assignments.id = $1 AND assignments.organisation_id = $2
           AND assignments.person_id = $3
           AND assignments.status <> 'cancelled'
           AND tasks.status <> 'cancelled'`,
        [assignmentId, access.context.organisationId, targetId],
      );
      if (!assignment.rows[0]) return "ASSIGNMENT_NOT_FOUND" as const;
      const attendanceRequired = await transaction.query<{ required: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM nova.person_role_assignments assignments
           JOIN nova.role_operational_policies policies ON policies.role_id = assignments.role_id
           WHERE assignments.person_id = $1
             AND assignments.effective_on <= nova.person_business_date($1)
             AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
             AND policies.attendance_required
         ) AS required`,
        [targetId],
      );
      if (attendanceRequired.rows[0]?.required) {
        const covered = await transaction.query(
          `SELECT 1 FROM nova.attendance_days
           WHERE person_id = $1
             AND checked_in_at <= $2::timestamptz
             AND checked_out_at IS NOT NULL
             AND checked_out_at >= $3::timestamptz
           LIMIT 1`,
          [targetId, startedAt, endedAt],
        );
        if (!covered.rows[0]) return "ATTENDANCE_REQUIRED" as const;
      }
      const overlap = await transaction.query(
        `SELECT 1 FROM nova.work_sessions
         WHERE person_id = $1 AND tstzrange(started_at, COALESCE(ended_at, clock_timestamp()), '[)') && tstzrange($2, $3, '[)')
         UNION ALL
         SELECT 1 FROM nova.work_timeline_adjustments
         WHERE person_id = $1 AND tstzrange(started_at, ended_at, '[)') && tstzrange($2, $3, '[)') LIMIT 1`,
        [targetId, startedAt, endedAt],
      );
      if (overlap.rows[0]) return "TIMELINE_ADJUSTMENT_OVERLAP" as const;
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.work_timeline_adjustments (
          organisation_id, person_id, assignment_id, started_at, ended_at, reason, created_by_person_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [access.context.organisationId, targetId, assignmentId, startedAt, endedAt, reason, access.context.userId],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("TIMELINE_ADJUSTMENT_CREATE_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.audit_events (organisation_id, actor_person_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'work.timeline_adjusted', 'work_timeline_adjustment', $3, $4)`,
        [access.context.organisationId, access.context.userId, id, JSON.stringify({ person_id: targetId, started_at: startedAt, ended_at: endedAt, reason, assignment_id: assignmentId })],
      );
      return id;
    });
    if (result === "TIMELINE_ADJUSTMENT_INPUT_INVALID") return json({ error: result }, 400);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "TARGET_NOT_FOUND") return json({ error: result }, 404);
    if (result === "TARGET_NOT_OPERATIONAL") return json({ error: result }, 409);
    if (result === "ATTENDANCE_REQUIRED") return json({ error: result }, 409);
    if (result === "TIMELINE_ADJUSTMENT_OVERLAP") return json({ error: result }, 409);
    return json({ adjustmentId: result }, 201);
  } catch (error) {
    if (error instanceof Error && /exclusion|unique/i.test(error.message)) return json({ error: "TIMELINE_ADJUSTMENT_OVERLAP" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
