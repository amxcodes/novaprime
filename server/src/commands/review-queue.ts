import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { permissionExistsSql } from "./work-context.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePendingReviewTarget(url: URL): { assignmentId?: string; taskId?: string } | null {
  const assignmentIds = url.searchParams.getAll("assignmentId");
  const taskIds = url.searchParams.getAll("taskId");
  if (assignmentIds.length > 1 || taskIds.length > 1) return null;
  const assignmentId = assignmentIds[0] || undefined;
  const taskId = taskIds[0] || undefined;
  if ((assignmentId && taskId) || (assignmentId && !uuidPattern.test(assignmentId)) || (taskId && !uuidPattern.test(taskId))) {
    return null;
  }
  return { assignmentId, taskId };
}

async function actor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const value = await requestActor(request);
  if (!value) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(value)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: value.context };
}

export const pendingReviewsReadSql = `WITH actor_business_date AS MATERIALIZED (
  SELECT nova.person_business_date($2) AS business_date
), active_grants AS MATERIALIZED (
  SELECT actor_date.business_date, grants.permission_key, grants.scope,
         grants.client_id, grants.client_workstream_id, grants.group_id,
         grants.office_id, grants.organisation_department_id
  FROM nova.person_role_assignments role_assignments
  CROSS JOIN actor_business_date actor_date
  JOIN nova.roles roles ON roles.id = role_assignments.role_id
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE role_assignments.person_id = $2
    AND role_assignments.effective_on <= actor_date.business_date
    AND (role_assignments.effective_until IS NULL OR role_assignments.effective_until >= actor_date.business_date)
    AND roles.archived_at IS NULL
)
SELECT assignments.id, assignments.task_id, assignments.person_id,
       assignments.reviewer_person_id, clients.id AS client_id, tasks.title,
       tasks.client_workstream_id, tasks.work_group_id,
       cycles.id AS cycle_id, cycles.cycle_number, cycles.submitted_at
FROM nova.task_assignments assignments
JOIN nova.tasks tasks ON tasks.id = assignments.task_id
LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
JOIN nova.task_review_cycles cycles
  ON cycles.assignment_id = assignments.id AND cycles.decided_at IS NULL
WHERE assignments.organisation_id = $1
  AND assignments.status = 'awaiting_review'
  AND assignments.reviewer_person_id = $2
  AND ($3::uuid IS NULL OR assignments.id = $3)
  AND ($4::uuid IS NULL OR assignments.task_id = $4)
  AND ${permissionExistsSql({
    actorId: "$2",
    organisationId: "$1",
    permissionKey: "'tasks.review'",
    clientId: "clients.id",
    clientWorkstreamId: "tasks.client_workstream_id",
    groupId: "tasks.work_group_id",
    taskId: "tasks.id",
  })}
ORDER BY cycles.submitted_at ASC
LIMIT 100`;

export async function readPendingReviews(request: Request): Promise<Response> {
  const access = await actor(request);
  if ("response" in access) return access.response;
  const target = parsePendingReviewTarget(new URL(request.url));
  if (!target) return json({ error: "INVALID_REVIEW_TARGET" }, 400);
  try {
    const result = await withDatabaseRequest(access.context, async (transaction) => {
      const rows = await transaction.query<{
        id: string; task_id: string; person_id: string; reviewer_person_id: string | null;
        client_id: string | null; title: string; client_workstream_id: string | null; work_group_id: string | null;
        cycle_id: string; cycle_number: number; submitted_at: Date;
      }>(pendingReviewsReadSql,
        [access.context.organisationId, access.context.userId, target.assignmentId ?? null, target.taskId ?? null],
      );
      return { reviews: rows.rows.map((row) => ({
        assignmentId: row.id,
        taskId: row.task_id,
        assigneePersonId: row.person_id,
        reviewerPersonId: row.reviewer_person_id,
        canReview: true,
        title: row.title,
        reviewCycleId: row.cycle_id,
        cycleNumber: row.cycle_number,
        submittedAt: row.submitted_at,
      })) };
    });
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
