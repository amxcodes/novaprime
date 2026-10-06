import { withDatabaseRequest } from "../db.js";
import { normalActor, permissionExistsSql } from "./work-context.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const REVIEW_HISTORY_LIMIT = 50;

export type ReviewerReviewRow = Readonly<{
  assignment_id: string;
  task_id: string;
  assignee_name: string;
  title: string;
  description: string | null;
  task_status: string;
  priority: string;
  due_date: string | null;
  client_id: string | null;
  client_name: string | null;
  client_workstream_id: string | null;
  client_workstream_name: string | null;
  organisation_workstream_id: string | null;
  organisation_workstream_name: string | null;
  group_id: string | null;
  group_name: string | null;
  current_cycle_id: string;
  current_cycle_number: number;
  current_submitted_at: Date | string;
  history_cycle_id: string;
  history_cycle_number: number;
  history_submitted_at: Date | string;
  history_decided_at: Date | string | null;
  history_decision: "approved" | "changes_requested" | null;
  history_feedback: string | null;
  history_total: number;
}>;

/**
 * Review-only projection: an open cycle must be assigned to this actor, the
 * assignment must still name them as its reviewer, and tasks.review must be
 * effective for the target. History is limited to cycles on that assignment;
 * reviewer identities are not exposed.
 */
export const reviewerReviewDetailReadSql = `WITH actor_business_date AS MATERIALIZED (
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
), current_review AS MATERIALIZED (
  SELECT assignments.id AS assignment_id, assignments.task_id,
         assignee.display_name AS assignee_name,
         tasks.title, tasks.description, tasks.status AS task_status, tasks.priority,
         tasks.due_date::text AS due_date,
         clients.id AS client_id, clients.name AS client_name,
         client_workstreams.id AS client_workstream_id,
         client_workstreams.name AS client_workstream_name,
         organisation_workstreams.id AS organisation_workstream_id,
         organisation_workstreams.name AS organisation_workstream_name,
         work_groups.id AS group_id, work_groups.name AS group_name,
         current_cycle.id AS current_cycle_id,
         current_cycle.cycle_number AS current_cycle_number,
         current_cycle.submitted_at AS current_submitted_at
  FROM nova.task_assignments assignments
  JOIN nova.tasks tasks ON tasks.id = assignments.task_id
  JOIN nova.people assignee ON assignee.id = assignments.person_id
  LEFT JOIN nova.client_workstreams client_workstreams
    ON client_workstreams.id = tasks.client_workstream_id
  LEFT JOIN nova.clients clients ON clients.id = client_workstreams.client_id
  LEFT JOIN nova.organisation_workstreams organisation_workstreams
    ON organisation_workstreams.id = tasks.organisation_workstream_id
  LEFT JOIN nova.work_groups work_groups ON work_groups.id = tasks.work_group_id
  JOIN nova.task_review_cycles current_cycle
    ON current_cycle.assignment_id = assignments.id
   AND current_cycle.decided_at IS NULL
   AND current_cycle.reviewer_person_id = $2
  WHERE assignments.organisation_id = $1
    AND assignments.id = $3
    AND assignments.status = 'awaiting_review'
    AND assignments.reviewer_person_id = $2
    AND ${permissionExistsSql({
      actorId: "$2",
      organisationId: "$1",
      permissionKey: "'tasks.review'",
      clientId: "clients.id",
      clientWorkstreamId: "tasks.client_workstream_id",
      groupId: "tasks.work_group_id",
      taskId: "tasks.id",
      allowedScopes: ["organisation", "client", "client_workstream", "group", "assigned_work"],
    })}
)
SELECT current_review.*,
       review_history.id AS history_cycle_id,
       review_history.cycle_number AS history_cycle_number,
       review_history.submitted_at AS history_submitted_at,
       review_history.decided_at AS history_decided_at,
       review_history.decision AS history_decision,
       review_history.feedback AS history_feedback,
       review_history.history_total
FROM current_review
JOIN LATERAL (
  SELECT cycles.id, cycles.cycle_number, cycles.submitted_at,
         cycles.decided_at, cycles.decision, cycles.feedback,
         count(*) OVER ()::integer AS history_total
  FROM nova.task_review_cycles cycles
  WHERE cycles.assignment_id = current_review.assignment_id
  ORDER BY cycles.cycle_number DESC
  LIMIT ${REVIEW_HISTORY_LIMIT}
) review_history ON true
ORDER BY review_history.cycle_number ASC`;

export function reviewerReviewDetailDto(rows: readonly ReviewerReviewRow[]) {
  const first = rows[0];
  if (!first) return undefined;
  return {
    review: {
      assignmentId: first.assignment_id,
      taskId: first.task_id,
      assignee: { displayName: first.assignee_name },
      task: {
        title: first.title,
        description: first.description,
        status: first.task_status,
        priority: first.priority,
        dueDate: first.due_date,
      },
      client: first.client_id ? { id: first.client_id, name: first.client_name } : null,
      workstream: first.client_workstream_id
        ? { id: first.client_workstream_id, name: first.client_workstream_name, kind: "client" as const }
        : { id: first.organisation_workstream_id, name: first.organisation_workstream_name, kind: "organisation" as const },
      group: first.group_id ? { id: first.group_id, name: first.group_name } : null,
      currentReviewCycleId: first.current_cycle_id,
      currentCycleNumber: first.current_cycle_number,
      submittedAt: first.current_submitted_at,
    },
    history: rows.map((row) => ({
      reviewCycleId: row.history_cycle_id,
      cycleNumber: row.history_cycle_number,
      submittedAt: row.history_submitted_at,
      decidedAt: row.history_decided_at,
      decision: row.history_decision,
      feedback: row.history_feedback,
      isCurrent: row.history_cycle_id === first.current_cycle_id,
    })),
    historyTruncated: first.history_total > REVIEW_HISTORY_LIMIT,
  };
}

export async function readReviewerReviewDetail(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "REVIEW_NOT_FOUND" }, 404);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const selected = await transaction.query<ReviewerReviewRow>(reviewerReviewDetailReadSql, [
        actor.context.organisationId,
        actor.context.userId,
        assignmentId,
      ]);
      return reviewerReviewDetailDto(selected.rows);
    });
    return result ? json(result) : json({ error: "REVIEW_NOT_FOUND" }, 404);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
