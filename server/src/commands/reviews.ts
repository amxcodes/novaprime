import type { PoolClient } from "pg";
import { normalizeReviewFeedback, REVIEW_FEEDBACK_MAX_LENGTH } from "../../../web/review-actions.js";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";
import { personCanReviewTarget } from "./work-context.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function actor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); } catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const value = await requestActor(request);
  if (!value) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(value)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: value.context };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => ({}));
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export type ReviewDecisionInput = Readonly<{
  decision: "approved" | "changes_requested";
  expectedReviewCycleId: string;
  feedback: string | null;
}>;

export function parseReviewDecisionInput(value: unknown): ReviewDecisionInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.decision !== "approved" && input.decision !== "changes_requested") return null;
  if (typeof input.expectedReviewCycleId !== "string" || !uuidPattern.test(input.expectedReviewCycleId)) return null;

  let feedback: string | null = null;
  if (input.feedback !== undefined && input.feedback !== null) {
    if (typeof input.feedback !== "string") return null;
    const normalized = normalizeReviewFeedback(input.feedback);
    if (!normalized || normalized.length > REVIEW_FEEDBACK_MAX_LENGTH) return null;
    feedback = normalized;
  }
  if (input.decision === "changes_requested" && feedback === null) return null;
  return {
    decision: input.decision,
    expectedReviewCycleId: input.expectedReviewCycleId,
    feedback,
  };
}

type Assignment = Readonly<{ id: string; task_id: string; person_id: string; reviewer_person_id: string | null; review_required: boolean; status: string; task_status: string; client_id: string | null; client_workstream_id: string | null; work_group_id: string | null; title: string }>;

async function assignment(transaction: PoolClient, id: string, organisationId: string): Promise<Assignment | undefined> {
  const result = await transaction.query<Assignment>(
    `SELECT assignments.id, assignments.task_id, assignments.person_id,
            assignments.reviewer_person_id, assignments.review_required,
            assignments.status, tasks.status AS task_status,
            clients.id AS client_id,
            tasks.client_workstream_id, tasks.work_group_id, tasks.title
     FROM nova.task_assignments assignments
     JOIN nova.tasks tasks ON tasks.id = assignments.task_id
     LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
     LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
     WHERE assignments.id = $1 AND assignments.organisation_id = $2
     FOR UPDATE OF assignments, tasks`,
    [id, organisationId],
  );
  return result.rows[0];
}

async function permitted(transaction: PoolClient, actorId: string, organisationId: string, key: string, row: Assignment): Promise<boolean> {
  if (key === "tasks.review") {
    return personCanReviewTarget(transaction, actorId, organisationId, {
      clientId: row.client_id ?? undefined,
      clientWorkstreamId: row.client_workstream_id ?? undefined,
      groupId: row.work_group_id ?? undefined,
      taskId: row.task_id,
    });
  }
  const result = await transaction.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1 AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL AND grants.permission_key = $2
         AND (grants.scope = 'organisation'
           OR (grants.scope = 'assigned_work' AND EXISTS (
               SELECT 1 FROM nova.task_assignments own
               WHERE own.id = $3 AND own.organisation_id = $4
               AND (own.person_id = $1 OR own.reviewer_person_id = $1)))
     )) AS allowed`,
    [actorId, key, row.id, organisationId],
  );
  return result.rows[0]?.allowed === true;
}

export async function submitAssignment(request: Request, assignmentId: string): Promise<Response> {
  const access = await actor(request);
  if ("response" in access) return access.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(access.context, async (transaction) => {
      const row = await assignment(transaction, assignmentId, access.context.organisationId);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (row.person_id !== access.context.userId || !await permitted(transaction, access.context.userId, access.context.organisationId, "tasks.submit", row)) return "PERMISSION_DENIED" as const;
      if (!["in_progress", "changes_requested"].includes(row.status)) return "ASSIGNMENT_NOT_SUBMITTABLE" as const;
      let reviewerPersonId = row.reviewer_person_id;
      let reviewBlocked = row.review_required && !reviewerPersonId;
      if (row.review_required && reviewerPersonId && !await personCanReviewTarget(
        transaction,
        reviewerPersonId,
        access.context.organisationId,
        {
          clientId: row.client_id ?? undefined,
          clientWorkstreamId: row.client_workstream_id ?? undefined,
          groupId: row.work_group_id ?? undefined,
          taskId: row.task_id,
        },
      )) {
        reviewerPersonId = null;
        reviewBlocked = true;
      }
      const nextStatus = row.review_required ? "awaiting_review" : "approved";
      await transaction.query(
        `UPDATE nova.task_assignments
         SET status = $2::nova.assignment_status,
             resolution_source = CASE WHEN $3 THEN NULL ELSE 'policy' END,
             reviewer_person_id = CASE WHEN $3 THEN $4::uuid ELSE NULL::uuid END,
             review_blocked_reason = CASE WHEN $5 THEN CASE WHEN $6 THEN 'REVIEWER_UNAVAILABLE' ELSE 'NO_ELIGIBLE_REVIEWER' END ELSE NULL END,
             review_blocked_at = CASE WHEN $5 THEN clock_timestamp() ELSE NULL END
         WHERE id = $1`,
        [assignmentId, nextStatus, row.review_required, reviewerPersonId, reviewBlocked, row.reviewer_person_id !== null && reviewerPersonId === null],
      );
      if (row.review_required) {
        await transaction.query("UPDATE nova.tasks SET status = 'submitted' WHERE id = $1 AND status NOT IN ('cancelled', 'done')", [row.task_id]);
      } else {
        const aggregate = await transaction.query<{ pending: boolean; requires_review: boolean }>(
          `SELECT
             EXISTS (
               SELECT 1 FROM nova.task_assignments
               WHERE task_id = $1 AND status NOT IN ('approved', 'cancelled')
             ) AS pending,
             EXISTS (
               SELECT 1 FROM nova.task_assignments
               WHERE task_id = $1 AND status <> 'cancelled' AND review_required
             ) AS requires_review`,
          [row.task_id],
        );
        const aggregateStatus = aggregate.rows[0]?.pending
          ? "in_progress"
          : aggregate.rows[0]?.requires_review
            ? "approved"
            : "done";
        await transaction.query("UPDATE nova.tasks SET status = $2::nova.task_status WHERE id = $1 AND status NOT IN ('cancelled', 'done')", [row.task_id, aggregateStatus]);
      }
      if (row.review_required) {
        const cycle = await transaction.query<{ id: string }>(
          `INSERT INTO nova.task_review_cycles (organisation_id, assignment_id, cycle_number, reviewer_person_id)
           SELECT $1, $2, COALESCE(max(cycle_number), 0) + 1, $3
           FROM nova.task_review_cycles WHERE assignment_id = $2 RETURNING id`,
          [access.context.organisationId, assignmentId, reviewerPersonId],
        );
        if (reviewerPersonId) {
          await enqueueNotification(transaction, {
            organisationId: access.context.organisationId, recipientPersonId: reviewerPersonId, eventKey: "task.review_requested",
            title: "Review requested", body: `Work submitted for review: ${row.title}.`, aggregateType: "task_assignment", aggregateId: assignmentId,
            deepLink: "/?view=work&review=" + assignmentId, idempotencyKey: `task.submitted:${assignmentId}:${cycle.rows[0]?.id ?? "cycle"}`,
          });
        }
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (organisation_id, actor_person_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'tasks.submitted', 'task_assignment', $3, $4)`,
        [access.context.organisationId, access.context.userId, assignmentId, JSON.stringify({ task_id: row.task_id, review_required: row.review_required, review_blocked: reviewBlocked, reviewer_unavailable: row.reviewer_person_id !== null && reviewerPersonId === null })],
      );
      return { assignmentId, status: nextStatus, reviewBlocked };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch (error) {
    if (error instanceof Error && /unique|exclusion/i.test(error.message)) return json({ error: "REVIEW_CYCLE_CONFLICT" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function reviewAssignment(request: Request, assignmentId: string): Promise<Response> {
  const access = await actor(request);
  if ("response" in access) return access.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  const input = parseReviewDecisionInput(await body(request));
  if (!input) return json({ error: "REVIEW_INPUT_INVALID" }, 400);
  const { decision, expectedReviewCycleId, feedback } = input;
  try {
    const result = await withDatabaseRequest(access.context, async (transaction) => {
      const row = await assignment(transaction, assignmentId, access.context.organisationId);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (row.reviewer_person_id !== access.context.userId || !await permitted(transaction, access.context.userId, access.context.organisationId, "tasks.review", row)) return "PERMISSION_DENIED" as const;
      const cycle = await transaction.query<{ id: string }>(
        `SELECT id FROM nova.task_review_cycles WHERE assignment_id = $1 AND decided_at IS NULL FOR UPDATE`, [assignmentId],
      );
      const cycleId = cycle.rows[0]?.id;
      if (!cycleId || row.status !== "awaiting_review") return "REVIEW_NOT_OPEN" as const;
      if (cycleId !== expectedReviewCycleId) return "REVIEW_CYCLE_STALE" as const;
      await transaction.query(
        `UPDATE nova.task_review_cycles SET decision = $2, feedback = $3, decided_at = clock_timestamp() WHERE id = $1`,
        [cycleId, decision, feedback],
      );
      await transaction.query(
        `UPDATE nova.task_assignments
         SET status = $2::nova.assignment_status,
             resolution_source = CASE WHEN $3 THEN 'review' ELSE NULL END
         WHERE id = $1`,
        [assignmentId, decision === "approved" ? "approved" : "changes_requested", decision === "approved"],
      );
      if (decision === "changes_requested") {
        await transaction.query("UPDATE nova.tasks SET status = 'returned' WHERE id = $1 AND status <> 'cancelled'", [row.task_id]);
      } else {
        const aggregate = await transaction.query<{ pending: boolean; requires_review: boolean }>(
          `SELECT
             EXISTS (
               SELECT 1 FROM nova.task_assignments
               WHERE task_id = $1 AND status NOT IN ('approved', 'cancelled')
             ) AS pending,
             EXISTS (
               SELECT 1 FROM nova.task_assignments
               WHERE task_id = $1 AND status <> 'cancelled' AND review_required
             ) AS requires_review`,
          [row.task_id],
        );
        if (!aggregate.rows[0]?.pending) {
          await transaction.query(
            "UPDATE nova.tasks SET status = $2::nova.task_status WHERE id = $1 AND status <> 'cancelled'",
            [row.task_id, aggregate.rows[0]?.requires_review ? "approved" : "done"],
          );
        }
      }
      await transaction.query(
        `INSERT INTO nova.audit_events (organisation_id, actor_person_id, action, target_type, target_id, details)
         VALUES ($1, $2, $3, 'task_assignment', $4, $5)`,
        [access.context.organisationId, access.context.userId, `tasks.${decision}`, assignmentId, JSON.stringify({ cycle_id: cycleId, feedback })],
      );
      await enqueueNotification(transaction, {
        organisationId: access.context.organisationId, recipientPersonId: row.person_id,
        eventKey: decision === "approved" ? "task.approved" : "task.changes_requested",
        title: decision === "approved" ? "Work approved" : "Changes requested",
        body: decision === "approved" ? `Your submitted work was approved: ${row.title}.` : `Changes were requested for ${row.title}.${feedback ? ` ${feedback}` : ""}`,
        aggregateType: "task_assignment", aggregateId: assignmentId, deepLink: "/?view=work&task=" + row.task_id,
        idempotencyKey: `task.reviewed:${assignmentId}:${cycleId}:${decision}`,
      });
      return { assignmentId, status: decision };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "REVIEW_CYCLE_STALE") return json({ error: result }, 409);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
