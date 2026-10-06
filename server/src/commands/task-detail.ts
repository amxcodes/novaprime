import type { PoolClient } from "pg";
import { withDatabaseRequest } from "../db.js";
import { hasPermission, normalActor, permissionExistsSql, readTaskPermissionHints } from "./work-context.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type TaskRow = Readonly<{
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  created_at: Date;
  due_date: string | null;
  due_date_revision: number;
  billing_class: "billable" | "non_billable";
  billing_policy_source: string;
  billing_policy_revision: number;
  correction_of_task_id: string | null;
  correction_reason: string | null;
  task_catalog_entry_id: string | null;
  task_catalog_revision: number | null;
  client_id: string | null;
  client_name: string | null;
  client_workstream_id: string | null;
  workstream_name: string | null;
  organisation_workstream_id: string | null;
  organisation_workstream_name: string | null;
  work_group_id: string | null;
  work_group_name: string | null;
  department_id: string | null;
  department_name: string | null;
}>;

/**
 * Exact-record read. The shared effective-grant predicate runs before task
 * fields are projected, so missing and out-of-scope IDs have the same result.
 */
export const taskDetailReadSql = `WITH actor_business_date AS MATERIALIZED (
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
SELECT tasks.id, tasks.title, tasks.description, tasks.status, tasks.priority,
       tasks.created_at, tasks.due_date::text, tasks.due_date_revision,
       tasks.billing_class, tasks.billing_policy_source, tasks.billing_policy_revision,
       tasks.correction_of_task_id, tasks.correction_reason,
       tasks.task_catalog_entry_id, tasks.task_catalog_revision,
       clients.id AS client_id, clients.name AS client_name,
       client_workstreams.id AS client_workstream_id,
       client_workstreams.name AS workstream_name,
       organisation_workstreams.id AS organisation_workstream_id,
       organisation_workstreams.name AS organisation_workstream_name,
       work_groups.id AS work_group_id, work_groups.name AS work_group_name,
       departments.id AS department_id, departments.name AS department_name
FROM nova.tasks
LEFT JOIN nova.client_workstreams
  ON client_workstreams.id = tasks.client_workstream_id
LEFT JOIN nova.clients
  ON clients.id = client_workstreams.client_id
LEFT JOIN nova.organisation_workstreams
  ON organisation_workstreams.id = tasks.organisation_workstream_id
LEFT JOIN nova.work_groups
  ON work_groups.id = tasks.work_group_id
LEFT JOIN nova.organisation_departments departments
  ON departments.id = tasks.organisation_department_id
WHERE tasks.organisation_id = $1
  AND tasks.id = $3
  AND ${permissionExistsSql({
    actorId: "$2",
    organisationId: "$1",
    permissionKey: "'tasks.view'",
    clientId: "clients.id",
    clientWorkstreamId: "tasks.client_workstream_id",
    groupId: "tasks.work_group_id",
    taskId: "tasks.id",
  })}
LIMIT 1`;

export const taskDetailAssignmentsReadSql = `SELECT people.display_name AS person_name,
       reviewers.display_name AS reviewer_name, assignments.review_required,
       assignments.review_blocked_reason, assignments.status
FROM nova.task_assignments assignments
JOIN nova.people people ON people.id = assignments.person_id
LEFT JOIN nova.people reviewers ON reviewers.id = assignments.reviewer_person_id
WHERE assignments.organisation_id = $1
  AND assignments.task_id = $2
  AND ($3::boolean OR assignments.person_id = $4)
ORDER BY assignments.assigned_at DESC`;

async function correctionLink(
  transaction: PoolClient,
  task: TaskRow,
  organisationId: string,
  actorId: string,
): Promise<{ taskId: string; title: string } | null> {
  if (!task.correction_of_task_id) return null;
  const sourceContext = await transaction.query<{
    id: string;
    client_id: string | null;
    client_workstream_id: string | null;
    group_id: string | null;
  }>(
    `SELECT source.id, clients.id AS client_id,
            source.client_workstream_id, source.work_group_id AS group_id
     FROM nova.tasks source
     LEFT JOIN nova.client_workstreams workstreams
       ON workstreams.id = source.client_workstream_id
     LEFT JOIN nova.clients ON clients.id = workstreams.client_id
     WHERE source.id = $1 AND source.organisation_id = $2`,
    [task.correction_of_task_id, organisationId],
  );
  const source = sourceContext.rows[0];
  if (!source || !await hasPermission(transaction, actorId, organisationId, "tasks.view", {
    clientId: source.client_id ?? undefined,
    clientWorkstreamId: source.client_workstream_id ?? undefined,
    groupId: source.group_id ?? undefined,
    taskId: source.id,
  })) return null;
  const title = await transaction.query<{ title: string }>(
    `SELECT title FROM nova.tasks WHERE id = $1 AND organisation_id = $2`,
    [source.id, organisationId],
  );
  return title.rows[0] ? { taskId: source.id, title: title.rows[0].title } : null;
}

export async function readTaskDetail(request: Request, taskId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(taskId)) return json({ error: "TASK_NOT_FOUND" }, 404);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const selected = await transaction.query<TaskRow>(taskDetailReadSql, [
        actor.context.organisationId,
        actor.context.userId,
        taskId,
      ]);
      const row = selected.rows[0];
      if (!row) return undefined;

      const target = {
        clientId: row.client_id ?? undefined,
        clientWorkstreamId: row.client_workstream_id ?? undefined,
        groupId: row.work_group_id ?? undefined,
        taskId: row.id,
      };
      const capabilities = await readTaskPermissionHints(
        transaction, actor.context.userId, actor.context.organisationId, target,
      );
      if (!capabilities.canView) return undefined;

      // A task-scoped assigned_work grant lets a person inspect their own
      // assignment; broader task.view grants can inspect the assignment roster.
      const { taskId: _taskId, ...taskScope } = target;
      const canViewRoster = await hasPermission(
        transaction, actor.context.userId, actor.context.organisationId, "tasks.view", taskScope,
      );
      const assignments = await transaction.query<{
        person_name: string;
        reviewer_name: string | null;
        review_required: boolean;
        review_blocked_reason: string | null;
        status: string;
      }>(taskDetailAssignmentsReadSql, [
        actor.context.organisationId,
        taskId,
        canViewRoster,
        actor.context.userId,
      ]);

      const correctionOf = await correctionLink(
        transaction, row, actor.context.organisationId, actor.context.userId,
      );
      return {
        task: {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          createdAt: row.created_at,
          dueDate: row.due_date,
          dueDateRevision: row.due_date_revision,
          canEditDueDate: capabilities.canEditDueDate,
          billingClass: row.billing_class,
          billingPolicySource: row.billing_policy_source,
          billingPolicyRevision: row.billing_policy_revision,
          taskDefinition: row.task_catalog_entry_id
            ? { entryId: row.task_catalog_entry_id, revision: row.task_catalog_revision }
            : null,
          isCorrection: row.correction_of_task_id !== null,
          correctionReason: row.correction_of_task_id ? row.correction_reason : null,
          correctionOf,
          client: row.client_id ? { id: row.client_id, name: row.client_name } : null,
          workstream: row.client_workstream_id
            ? { id: row.client_workstream_id, name: row.workstream_name, kind: "client" }
            : { id: row.organisation_workstream_id, name: row.organisation_workstream_name, kind: "organisation" },
          group: row.work_group_id ? { id: row.work_group_id, name: row.work_group_name } : null,
          department: row.department_id ? { id: row.department_id, name: row.department_name } : null,
          assignments: assignments.rows.map((assignment) => ({
            personName: assignment.person_name,
            reviewerName: assignment.reviewer_name,
            reviewRequired: assignment.review_required,
            reviewBlockedReason: assignment.review_blocked_reason,
            status: assignment.status,
          })),
        },
      };
    });
    return result ? json(result) : json({ error: "TASK_NOT_FOUND" }, 404);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
