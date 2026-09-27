import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";
import { personCanReviewTarget } from "./work-context.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function actor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const value = await requestActor(request);
  if (!value) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(value)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: value.context };
}

async function canReview(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  row: { id: string; reviewer_person_id: string | null; client_id: string | null; client_workstream_id: string | null; work_group_id: string | null; task_id: string },
): Promise<boolean> {
  return row.reviewer_person_id === actorId && await personCanReviewTarget(transaction, actorId, organisationId, {
    clientId: row.client_id ?? undefined,
    clientWorkstreamId: row.client_workstream_id ?? undefined,
    groupId: row.work_group_id ?? undefined,
    taskId: row.task_id,
  });
}

export async function readPendingReviews(request: Request): Promise<Response> {
  const access = await actor(request);
  if ("response" in access) return access.response;
  try {
    const result = await withDatabaseRequest(access.context, async (transaction) => {
      const rows = await transaction.query<{
        id: string; task_id: string; person_id: string; reviewer_person_id: string | null;
        client_id: string | null; title: string; client_workstream_id: string | null; work_group_id: string | null;
        cycle_id: string; cycle_number: number; submitted_at: Date;
      }>(
        `SELECT assignments.id, assignments.task_id, assignments.person_id,
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
           AND assignments.reviewer_person_id IS NOT NULL
         ORDER BY cycles.submitted_at ASC
         LIMIT 100`,
        [access.context.organisationId],
      );
      const pending = [];
      for (const row of rows.rows) {
        if (await canReview(transaction, access.context.userId, access.context.organisationId, row)) {
          pending.push({
            assignmentId: row.id,
            taskId: row.task_id,
            assigneePersonId: row.person_id,
            reviewerPersonId: row.reviewer_person_id,
            title: row.title,
            reviewCycleId: row.cycle_id,
            cycleNumber: row.cycle_number,
            submittedAt: row.submitted_at,
          });
        } else if (row.reviewer_person_id) {
          const stillAssigned = await transaction.query<{ reviewer_person_id: string | null }>(
            `UPDATE nova.task_assignments
             SET reviewer_person_id = NULL, review_blocked_reason = 'REVIEWER_UNAVAILABLE', review_blocked_at = clock_timestamp()
             WHERE id = $1 AND status = 'awaiting_review' AND reviewer_person_id = $2
             RETURNING reviewer_person_id`,
            [row.id, row.reviewer_person_id],
          );
          if (stillAssigned.rows[0]) {
            await transaction.query(
              `UPDATE nova.task_review_cycles SET reviewer_person_id = NULL
               WHERE assignment_id = $1 AND decided_at IS NULL`,
              [row.id],
            );
            await transaction.query(
              `INSERT INTO nova.audit_events (organisation_id, actor_person_id, action, target_type, target_id, details)
               VALUES ($1, $2, 'tasks.reviewer_unavailable', 'task_assignment', $3, $4)`,
              [access.context.organisationId, access.context.userId, row.id, JSON.stringify({ previous_reviewer_person_id: row.reviewer_person_id })],
            );
            await enqueueNotification(transaction, {
              organisationId: access.context.organisationId,
              recipientPersonId: row.person_id,
              eventKey: "task.reviewer_unavailable",
              title: "Reviewer unavailable",
              body: `Your submitted work needs a new reviewer: ${row.title}.`,
              aggregateType: "task_assignment",
              aggregateId: row.id,
              deepLink: "/?view=today&task=" + row.task_id,
              idempotencyKey: `task.reviewer_unavailable:${row.id}:${row.reviewer_person_id}`,
            });
          }
        }
      }
      return { reviews: pending };
    });
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
