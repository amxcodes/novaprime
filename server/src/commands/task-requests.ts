import type { PoolClient } from "pg";
import { withDatabaseRequest } from "../db.js";
import {
  audit,
  body,
  hasPermission,
  normalActor,
  personCanReceiveAssignments,
  personCanReviewTarget,
  personIsOperational,
  type Target,
} from "./work-context.js";
import { enqueueNotification } from "./notifications.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

function id(value: unknown): string | undefined {
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

/** Returns null when absent and undefined when the optional query parameter is invalid. */
export function parseCollaborationRequestIdFilter(request: Request): string | null | undefined {
  const values = new URL(request.url).searchParams.getAll("requestId");
  if (values.length === 0) return null;
  if (values.length !== 1) return undefined;
  return id(values[0]);
}

export type CollaborationRequestKind = "reviewer" | "handover";

export function collaborationRequestNotificationTarget(
  kind: CollaborationRequestKind,
  requestId: string,
): Readonly<{ aggregateType: string; aggregateId: string; deepLink: string }> {
  if (!uuidPattern.test(requestId)) throw new Error("COLLABORATION_REQUEST_ID_INVALID");
  return {
    aggregateType: kind === "reviewer" ? "task_reviewer_request" : "task_handover_request",
    aggregateId: requestId,
    deepLink: `/?view=work&${kind}Request=${encodeURIComponent(requestId)}`,
  };
}

export const reviewerRequestsReadSql = `
  SELECT requests.id, requests.assignment_id, requests.requester_person_id,
         requests.candidate_reviewer_person_id, requests.request_kind, requests.reason,
         requests.status, requests.created_at, requests.expires_at, requests.resolved_at,
         tasks.title, tasks.id AS task_id, tasks.status AS task_status,
         assignments.status AS assignment_status,
         clients.id AS client_id, tasks.client_workstream_id, tasks.work_group_id,
         requests.expires_at <= clock_timestamp() AS is_expired
  FROM nova.task_reviewer_requests requests
  JOIN nova.task_assignments assignments ON assignments.id = requests.assignment_id
  JOIN nova.tasks tasks ON tasks.id = assignments.task_id
  LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
  LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
  WHERE requests.organisation_id = $1
    AND ($3::uuid IS NULL OR requests.id = $3)
    AND (requests.requester_person_id = $2 OR requests.candidate_reviewer_person_id = $2)
  ORDER BY requests.created_at DESC LIMIT 100`;

export const handoverRequestsReadSql = `
  SELECT requests.id, requests.assignment_id, requests.requester_person_id,
         requests.target_person_id, requests.reason, requests.status,
         requests.created_at, requests.expires_at, requests.resolved_at, tasks.title,
         tasks.id AS task_id, tasks.status AS task_status,
         assignments.person_id AS assignment_person_id, assignments.status AS assignment_status,
         clients.id AS client_id, tasks.client_workstream_id, tasks.work_group_id,
         EXISTS (
           SELECT 1 FROM nova.task_assignments existing
           WHERE existing.task_id = tasks.id AND existing.person_id = $2
             AND existing.id <> assignments.id AND existing.status <> 'cancelled'
         ) AS actor_already_assigned,
         requests.expires_at <= clock_timestamp() AS is_expired
  FROM nova.task_assignment_handover_requests requests
  JOIN nova.task_assignments assignments ON assignments.id = requests.assignment_id
  JOIN nova.tasks tasks ON tasks.id = assignments.task_id
  LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
  LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
  WHERE requests.organisation_id = $1
    AND ($3::uuid IS NULL OR requests.id = $3)
    AND (requests.requester_person_id = $2 OR requests.target_person_id = $2)
  ORDER BY requests.created_at DESC LIMIT 100`;

function reason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= 2000 ? result : undefined;
}

type Assignment = Readonly<{
  id: string;
  task_id: string;
  person_id: string;
  reviewer_person_id: string | null;
  review_required: boolean;
  review_blocked_reason: string | null;
  status: string;
  task_status: string;
  title: string;
  target: Target;
}>;

async function assignment(
  transaction: PoolClient,
  assignmentId: string,
  organisationId: string,
  forUpdate = false,
): Promise<Assignment | undefined> {
  const result = await transaction.query<{
    id: string; task_id: string; person_id: string; reviewer_person_id: string | null;
    review_required: boolean; review_blocked_reason: string | null; status: string; task_status: string; title: string;
    client_id: string | null; client_workstream_id: string | null; work_group_id: string | null;
  }>(
    `SELECT assignments.id, assignments.task_id, assignments.person_id,
            assignments.reviewer_person_id, assignments.review_required, assignments.review_blocked_reason,
            assignments.status, tasks.status AS task_status, tasks.title,
            clients.id AS client_id, tasks.client_workstream_id, tasks.work_group_id
     FROM nova.task_assignments assignments
     JOIN nova.tasks tasks ON tasks.id = assignments.task_id
     LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
     LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
     WHERE assignments.id = $1 AND assignments.organisation_id = $2
     ${forUpdate ? "FOR UPDATE OF assignments, tasks" : ""}`,
    [assignmentId, organisationId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    ...row,
    target: {
      ...(row.client_id ? { clientId: row.client_id } : {}),
      ...(row.client_workstream_id ? { clientWorkstreamId: row.client_workstream_id } : {}),
      ...(row.work_group_id ? { groupId: row.work_group_id } : {}),
      taskId: row.task_id,
    },
  };
}

function invalidState(row: Assignment): boolean {
  return row.task_status === "cancelled" || ["cancelled", "approved"].includes(row.status);
}

type RequestActionFlags = Readonly<{
  canAccept: boolean;
  canDecline: boolean;
  canWithdraw: boolean;
}>;

type ReviewerRequestActionInput = Readonly<{
  actorPersonId: string;
  requesterPersonId: string;
  candidateReviewerPersonId: string;
  requestStatus: string;
  expired: boolean;
  assignmentStatus: string;
  taskStatus: string;
  canReviewTarget: boolean;
}>;

/** Current display capabilities for a request; resolveReviewerRequest remains authoritative. */
export function reviewerRequestActionFlags(input: ReviewerRequestActionInput): RequestActionFlags {
  const assignmentActive = input.taskStatus !== "cancelled" &&
    !["cancelled", "approved"].includes(input.assignmentStatus);
  const requestOpen = input.requestStatus === "pending" && !input.expired && assignmentActive;
  const isRecipient = input.candidateReviewerPersonId === input.actorPersonId;
  return {
    canAccept: requestOpen && isRecipient && input.canReviewTarget,
    canDecline: requestOpen && isRecipient,
    canWithdraw: requestOpen && input.requesterPersonId === input.actorPersonId,
  };
}

type HandoverRequestActionInput = Readonly<{
  actorPersonId: string;
  requesterPersonId: string;
  targetPersonId: string;
  assignmentPersonId: string;
  requestStatus: string;
  expired: boolean;
  assignmentStatus: string;
  taskStatus: string;
  canReceiveAssignments: boolean;
  canAcceptTarget: boolean;
  alreadyAssigned: boolean;
}>;

/** Current display capabilities for a handover; resolveHandoverRequest remains authoritative. */
export function handoverRequestActionFlags(input: HandoverRequestActionInput): RequestActionFlags {
  const assignmentHandoverable = input.assignmentPersonId === input.requesterPersonId &&
    input.taskStatus !== "cancelled" &&
    ["assigned", "in_progress", "changes_requested"].includes(input.assignmentStatus);
  const requestOpen = input.requestStatus === "pending" && !input.expired && assignmentHandoverable;
  const isRecipient = input.targetPersonId === input.actorPersonId;
  return {
    canAccept: requestOpen && isRecipient && input.canReceiveAssignments &&
      input.canAcceptTarget && !input.alreadyAssigned,
    canDecline: requestOpen && isRecipient,
    canWithdraw: requestOpen && input.requesterPersonId === input.actorPersonId,
  };
}

async function notify(
  transaction: PoolClient,
  organisationId: string,
  recipientPersonId: string,
  eventKey: "task.reviewer_request" | "task.reviewer_accepted" | "task.reviewer_declined" | "task.handover_requested" | "task.handover_accepted" | "task.handover_declined",
  title: string,
  bodyText: string,
  requestId: string,
  assignmentId: string,
  suffix: string,
): Promise<void> {
  const kind = eventKey.startsWith("task.reviewer_") ? "reviewer" : "handover";
  const target = collaborationRequestNotificationTarget(kind, requestId);
  await enqueueNotification(transaction, {
    organisationId,
    recipientPersonId,
    eventKey,
    title,
    body: bodyText,
    aggregateType: target.aggregateType,
    aggregateId: target.aggregateId,
    deepLink: target.deepLink,
    idempotencyKey: `${eventKey}:${assignmentId}:${suffix}`,
  });
}

export async function createReviewerRequest(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const candidatePersonId = id(input.candidateReviewerPersonId);
  const requestReason = reason(input.reason);
  if (!uuidPattern.test(assignmentId) || !candidatePersonId || !requestReason) return json({ error: "REVIEWER_REQUEST_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const row = await assignment(transaction, assignmentId, actor.context.organisationId, true);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (invalidState(row)) return "ASSIGNMENT_NOT_REQUESTABLE" as const;
      if (row.person_id !== actor.context.userId || !await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.reviewer_request", row.target)) return "PERMISSION_DENIED" as const;
      if (candidatePersonId === row.person_id) return "SELF_REVIEW_NOT_ALLOWED" as const;
      if (!await personIsOperational(transaction, candidatePersonId, actor.context.organisationId)) return "REVIEWER_NOT_ASSIGNABLE" as const;
      const pending = await transaction.query("SELECT 1 FROM nova.task_reviewer_requests WHERE assignment_id = $1 AND status = 'pending' AND expires_at > clock_timestamp() FOR UPDATE", [assignmentId]);
      if (pending.rows[0]) return "REVIEWER_REQUEST_ALREADY_PENDING" as const;
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.task_reviewer_requests (
           organisation_id, assignment_id, requester_person_id, candidate_reviewer_person_id,
           request_kind, reason
         ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [actor.context.organisationId, assignmentId, actor.context.userId, candidatePersonId,
          row.reviewer_person_id || row.review_blocked_reason ? "replacement" : "initial", requestReason],
      );
      const requestId = created.rows[0]?.id;
      if (!requestId) throw new Error("REVIEWER_REQUEST_CREATE_RESULT_MISSING");
      if (!await personCanReviewTarget(transaction, candidatePersonId, actor.context.organisationId, row.target)) {
        await transaction.query("DELETE FROM nova.task_reviewer_requests WHERE id = $1", [requestId]);
        return "REVIEWER_NOT_ASSIGNABLE" as const;
      }
      await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.reviewer_requested", "task_reviewer_request", requestId, {
        assignment_id: assignmentId, candidate_reviewer_person_id: candidatePersonId,
      });
      await notify(transaction, actor.context.organisationId, candidatePersonId, "task.reviewer_request", "Reviewer request", `You were asked to review: ${row.title}.`, requestId, assignmentId, requestId);
      return { requestId, assignmentId, candidateReviewerPersonId: candidatePersonId };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return json({ error: "REVIEWER_REQUEST_ALREADY_PENDING" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function resolveReviewerRequest(request: Request, requestId: string, decision: "accept" | "decline" | "withdraw"): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const resolutionReason = input.reason === undefined || input.reason === null ? null : reason(input.reason);
  if (!uuidPattern.test(requestId) || (input.reason !== undefined && input.reason !== null && !resolutionReason)) return json({ error: "REVIEWER_REQUEST_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const locked = await transaction.query<{
        id: string; assignment_id: string; requester_person_id: string; candidate_reviewer_person_id: string;
        status: string; expires_at: Date; is_expired: boolean;
      }>(
        `SELECT id, assignment_id, requester_person_id, candidate_reviewer_person_id, status, expires_at,
                expires_at <= clock_timestamp() AS is_expired
         FROM nova.task_reviewer_requests
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [requestId, actor.context.organisationId],
      );
      const requestRow = locked.rows[0];
      if (!requestRow) return "REQUEST_NOT_FOUND" as const;
      if (requestRow.status !== "pending") return "REQUEST_NOT_PENDING" as const;
      if (requestRow.is_expired) {
        if (actor.context.userId !== requestRow.requester_person_id && actor.context.userId !== requestRow.candidate_reviewer_person_id) return "REQUEST_NOT_AUTHORIZED" as const;
        await transaction.query(`UPDATE nova.task_reviewer_requests SET status = 'expired', resolved_at = clock_timestamp(), resolved_by_person_id = $2, resolution_reason = 'Request expired' WHERE id = $1`, [requestId, actor.context.userId]);
        await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.reviewer_request_expired", "task_reviewer_request", requestId, { assignment_id: requestRow.assignment_id });
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: requestRow.requester_person_id,
          eventKey: "task.reviewer_request_expired",
          title: "Reviewer request expired",
          body: "Your reviewer request expired. Choose another reviewer.",
          ...collaborationRequestNotificationTarget("reviewer", requestId),
          idempotencyKey: "task.reviewer_request_expired:" + requestId,
        });
        return "REQUEST_EXPIRED" as const;
      }
      if (decision === "accept" && requestRow.candidate_reviewer_person_id !== actor.context.userId) return "REQUEST_RECIPIENT_ONLY" as const;
      if (decision === "decline" && requestRow.candidate_reviewer_person_id !== actor.context.userId) return "REQUEST_RECIPIENT_ONLY" as const;
      if (decision === "withdraw" && requestRow.requester_person_id !== actor.context.userId) return "REQUEST_REQUESTER_ONLY" as const;
      const row = await assignment(transaction, requestRow.assignment_id, actor.context.organisationId, true);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (invalidState(row)) return "ASSIGNMENT_NOT_REQUESTABLE" as const;
      if (decision === "accept") {
        if (!await personCanReviewTarget(transaction, actor.context.userId, actor.context.organisationId, row.target)) return "REVIEWER_NOT_ASSIGNABLE" as const;
        await transaction.query(
          `UPDATE nova.task_assignments
           SET reviewer_person_id = $2, review_required = true,
               reviewer_exception_reason = NULL, reviewer_exception_granted_by_person_id = NULL,
               reviewer_exception_granted_at = NULL, review_blocked_reason = NULL, review_blocked_at = NULL
           WHERE id = $1`,
          [row.id, actor.context.userId],
        );
        await transaction.query(`UPDATE nova.task_review_cycles SET reviewer_person_id = $2 WHERE assignment_id = $1 AND decided_at IS NULL`, [row.id, actor.context.userId]);
      }
      const nextStatus = decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "withdrawn";
      await transaction.query(
        `UPDATE nova.task_reviewer_requests
         SET status = $2::nova.task_reviewer_request_status, resolved_at = clock_timestamp(),
             resolved_by_person_id = $3, resolution_reason = $4
         WHERE id = $1`,
        [requestId, nextStatus, actor.context.userId, resolutionReason],
      );
      await audit(transaction, actor.context.organisationId, actor.context.userId, `tasks.reviewer_request_${decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "withdrawn"}`, "task_reviewer_request", requestId, { assignment_id: row.id, reason: resolutionReason });
      if (decision === "accept") {
        await notify(transaction, actor.context.organisationId, row.person_id, "task.reviewer_accepted", "Reviewer accepted", `A reviewer accepted your task: ${row.title}.`, requestId, row.id, requestId);
      } else if (decision === "decline") {
        await notify(transaction, actor.context.organisationId, row.person_id, "task.reviewer_declined", "Reviewer declined", `The requested reviewer declined: ${row.title}.`, requestId, row.id, requestId);
      }
      return { requestId, assignmentId: row.id, status: nextStatus };
    });
    if (result === "REQUEST_NOT_FOUND" || result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readReviewerRequests(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const requestId = parseCollaborationRequestIdFilter(request);
  if (requestId === undefined) return json({ error: "REQUEST_ID_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query<{
        id: string; assignment_id: string; requester_person_id: string;
        candidate_reviewer_person_id: string; request_kind: string; reason: string;
        status: string; created_at: Date; expires_at: Date; resolved_at: Date | null;
        title: string; task_id: string; task_status: string; assignment_status: string;
        client_id: string | null; client_workstream_id: string | null; work_group_id: string | null;
        is_expired: boolean;
      }>(
        reviewerRequestsReadSql,
        [actor.context.organisationId, actor.context.userId, requestId],
      );
      const requests = [];
      for (const row of rows.rows) {
        const isRecipient = row.candidate_reviewer_person_id === actor.context.userId;
        const canCheckReviewPermission = reviewerRequestActionFlags({
          actorPersonId: actor.context.userId,
          requesterPersonId: row.requester_person_id,
          candidateReviewerPersonId: row.candidate_reviewer_person_id,
          requestStatus: row.status,
          expired: row.is_expired,
          assignmentStatus: row.assignment_status,
          taskStatus: row.task_status,
          canReviewTarget: true,
        }).canAccept;
        const canReviewTarget = canCheckReviewPermission && await personCanReviewTarget(
          transaction,
          actor.context.userId,
          actor.context.organisationId,
          {
            ...(row.client_id ? { clientId: row.client_id } : {}),
            ...(row.client_workstream_id ? { clientWorkstreamId: row.client_workstream_id } : {}),
            ...(row.work_group_id ? { groupId: row.work_group_id } : {}),
            taskId: row.task_id,
          },
        );
        const { task_id: _taskId, task_status: _taskStatus, assignment_status: _assignmentStatus,
          client_id: _clientId, client_workstream_id: _clientWorkstreamId, work_group_id: _workGroupId,
          is_expired: _isExpired, ...requestData } = row;
        requests.push({
          ...requestData,
          isRecipient,
          ...reviewerRequestActionFlags({
            actorPersonId: actor.context.userId,
            requesterPersonId: row.requester_person_id,
            candidateReviewerPersonId: row.candidate_reviewer_person_id,
            requestStatus: row.status,
            expired: row.is_expired,
            assignmentStatus: row.assignment_status,
            taskStatus: row.task_status,
            canReviewTarget,
          }),
        });
      }
      return requests;
    });
    return json({ requests: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readAssignmentCandidates(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const row = await assignment(transaction, assignmentId, actor.context.organisationId);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (invalidState(row)) return "ASSIGNMENT_NOT_REQUESTABLE" as const;
      if (row.person_id !== actor.context.userId) return "PERMISSION_DENIED" as const;
      const canRequestReviewer = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.reviewer_request", row.target);
      const canRequestHandover = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.handover_request", row.target);
      if (!canRequestReviewer && !canRequestHandover) return "PERMISSION_DENIED" as const;
      const people = await transaction.query<{ id: string; display_name: string }>(
        `SELECT people.id, people.display_name
         FROM nova.people people
         JOIN nova.person_status_periods statuses ON statuses.person_id = people.id AND statuses.ended_at IS NULL
         WHERE people.organisation_id = $1 AND people.id <> $2
           AND statuses.status IN ('active', 'notice')
         ORDER BY people.display_name`,
        [actor.context.organisationId, actor.context.userId],
      );
      const reviewers = [];
      const handoverTargets = [];
      for (const person of people.rows) {
        if (canRequestReviewer && await personCanReviewTarget(transaction, person.id, actor.context.organisationId, row.target)) reviewers.push(person);
        if (canRequestHandover && await personCanReceiveAssignments(transaction, person.id, actor.context.organisationId)) handoverTargets.push(person);
      }
      return { reviewers, handoverTargets };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "ASSIGNMENT_NOT_REQUESTABLE") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function createHandoverRequest(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const targetPersonId = id(input.targetPersonId);
  const requestReason = reason(input.reason);
  if (!uuidPattern.test(assignmentId) || !targetPersonId || !requestReason) return json({ error: "HANDOVER_REQUEST_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const row = await assignment(transaction, assignmentId, actor.context.organisationId, true);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (invalidState(row) || !["assigned", "in_progress", "changes_requested"].includes(row.status)) return "ASSIGNMENT_NOT_HANDOVERABLE" as const;
      if (row.person_id !== actor.context.userId || !await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.handover_request", row.target)) return "PERMISSION_DENIED" as const;
      if (targetPersonId === row.person_id) return "SELF_HANDOVER_NOT_ALLOWED" as const;
      if (!await personIsOperational(transaction, targetPersonId, actor.context.organisationId) || !await personCanReceiveAssignments(transaction, targetPersonId, actor.context.organisationId)) return "PERSON_NOT_ASSIGNABLE" as const;
      const pending = await transaction.query("SELECT 1 FROM nova.task_assignment_handover_requests WHERE assignment_id = $1 AND status = 'pending' AND expires_at > clock_timestamp() FOR UPDATE", [assignmentId]);
      if (pending.rows[0]) return "HANDOVER_REQUEST_ALREADY_PENDING" as const;
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.task_assignment_handover_requests (organisation_id, assignment_id, requester_person_id, target_person_id, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [actor.context.organisationId, assignmentId, actor.context.userId, targetPersonId, requestReason],
      );
      const requestId = created.rows[0]?.id;
      if (!requestId) throw new Error("HANDOVER_REQUEST_CREATE_RESULT_MISSING");
      await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.handover_requested", "task_handover_request", requestId, { assignment_id: assignmentId, target_person_id: targetPersonId });
      await notify(transaction, actor.context.organisationId, targetPersonId, "task.handover_requested", "Handover request", `You were asked to take over: ${row.title}.`, requestId, assignmentId, requestId);
      return { requestId, assignmentId, targetPersonId };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return json({ error: "HANDOVER_REQUEST_ALREADY_PENDING" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function resolveHandoverRequest(request: Request, requestId: string, decision: "accept" | "decline" | "withdraw"): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const resolutionReason = input.reason === undefined || input.reason === null ? null : reason(input.reason);
  if (!uuidPattern.test(requestId) || (input.reason !== undefined && input.reason !== null && !resolutionReason)) return json({ error: "HANDOVER_REQUEST_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const locked = await transaction.query<{
        id: string; assignment_id: string; requester_person_id: string; target_person_id: string;
        status: string; expires_at: Date; is_expired: boolean;
      }>(
        `SELECT id, assignment_id, requester_person_id, target_person_id, status, expires_at,
                expires_at <= clock_timestamp() AS is_expired
         FROM nova.task_assignment_handover_requests WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [requestId, actor.context.organisationId],
      );
      const requestRow = locked.rows[0];
      if (!requestRow) return "REQUEST_NOT_FOUND" as const;
      if (requestRow.status !== "pending") return "REQUEST_NOT_PENDING" as const;
      if (requestRow.is_expired) {
        if (actor.context.userId !== requestRow.requester_person_id && actor.context.userId !== requestRow.target_person_id) return "REQUEST_NOT_AUTHORIZED" as const;
        await transaction.query(`UPDATE nova.task_assignment_handover_requests SET status = 'expired', resolved_at = clock_timestamp(), resolved_by_person_id = $2, resolution_reason = 'Request expired' WHERE id = $1`, [requestId, actor.context.userId]);
        await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.handover_request_expired", "task_handover_request", requestId, { assignment_id: requestRow.assignment_id });
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: requestRow.requester_person_id,
          eventKey: "task.handover_request_expired",
          title: "Handover request expired",
          body: "Your handover request expired. Choose another person.",
          ...collaborationRequestNotificationTarget("handover", requestId),
          idempotencyKey: "task.handover_request_expired:" + requestId,
        });
        return "REQUEST_EXPIRED" as const;
      }
      if (decision === "accept" && requestRow.target_person_id !== actor.context.userId) return "REQUEST_RECIPIENT_ONLY" as const;
      if (decision === "decline" && requestRow.target_person_id !== actor.context.userId) return "REQUEST_RECIPIENT_ONLY" as const;
      if (decision === "withdraw" && requestRow.requester_person_id !== actor.context.userId) return "REQUEST_REQUESTER_ONLY" as const;
      const row = await assignment(transaction, requestRow.assignment_id, actor.context.organisationId, true);
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (row.person_id !== requestRow.requester_person_id || invalidState(row) || !["assigned", "in_progress", "changes_requested"].includes(row.status)) return "ASSIGNMENT_NOT_HANDOVERABLE" as const;
      if (decision === "accept") {
        if (!await personIsOperational(transaction, actor.context.userId, actor.context.organisationId) || !await personCanReceiveAssignments(transaction, actor.context.userId, actor.context.organisationId)) return "PERSON_NOT_ASSIGNABLE" as const;
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.handover_accept", row.target)) return "PERMISSION_DENIED" as const;
        // Do not lock a second assignment here: reciprocal handovers could lock
        // source rows in opposite order. The partial unique index arbitrates races.
        const existingAssignment = await transaction.query<{ id: string }>(
          `SELECT id FROM nova.task_assignments
           WHERE task_id = $1 AND person_id = $2 AND id <> $3 AND status <> 'cancelled'`,
          [row.task_id, actor.context.userId, row.id],
        );
        if (existingAssignment.rows[0]) return "PERSON_ALREADY_ASSIGNED" as const;
        const effectiveAt = await transaction.query<{ now: Date }>("SELECT clock_timestamp() AS now");
        const at = effectiveAt.rows[0]?.now;
        if (!at) throw new Error("HANDOVER_TIME_MISSING");
        await transaction.query(`SELECT nova.close_assignment_work_sessions($1, $2, 'ASSIGNMENT_HANDOVER')`, [row.id, at]);
        await transaction.query(`UPDATE nova.task_assignments SET status = 'cancelled' WHERE id = $1`, [row.id]);
        let reviewerPersonId = row.reviewer_person_id;
        if (reviewerPersonId === actor.context.userId || (reviewerPersonId && !await personCanReviewTarget(transaction, reviewerPersonId, actor.context.organisationId, row.target))) reviewerPersonId = null;
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.task_assignments (
             organisation_id, task_id, person_id, reviewer_person_id, review_required, assigned_by_person_id
           ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [actor.context.organisationId, row.task_id, actor.context.userId, reviewerPersonId, row.review_required, row.person_id],
        );
        const newAssignmentId = created.rows[0]?.id;
        if (!newAssignmentId) throw new Error("HANDOVER_ASSIGNMENT_CREATE_RESULT_MISSING");
        await transaction.query(`UPDATE nova.tasks SET status = 'in_progress' WHERE id = $1 AND status NOT IN ('cancelled', 'done')`, [row.task_id]);
        await notify(transaction, actor.context.organisationId, row.person_id, "task.handover_accepted", "Handover accepted", `Your handover was accepted: ${row.title}.`, requestId, newAssignmentId, requestId + ":requester");
        await notify(transaction, actor.context.organisationId, actor.context.userId, "task.handover_accepted", "Task handed over", `You accepted the handover: ${row.title}.`, requestId, newAssignmentId, requestId + ":target");
        await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.handover_accepted", "task_assignment", newAssignmentId, { previous_assignment_id: row.id, previous_person_id: row.person_id });
        await transaction.query(`UPDATE nova.task_assignment_handover_requests SET status = 'accepted', resolved_at = clock_timestamp(), resolved_by_person_id = $2, resolution_reason = $3 WHERE id = $1`, [requestId, actor.context.userId, resolutionReason]);
        return { requestId, assignmentId: newAssignmentId, previousAssignmentId: row.id, status: "accepted" };
      }
      const nextStatus = decision === "decline" ? "declined" : "withdrawn";
      await transaction.query(`UPDATE nova.task_assignment_handover_requests SET status = $2::nova.task_handover_request_status, resolved_at = clock_timestamp(), resolved_by_person_id = $3, resolution_reason = $4 WHERE id = $1`, [requestId, nextStatus, actor.context.userId, resolutionReason]);
      await audit(transaction, actor.context.organisationId, actor.context.userId, `tasks.handover_request_${decision === "decline" ? "declined" : "withdrawn"}`, "task_handover_request", requestId, { assignment_id: row.id, reason: resolutionReason });
      if (decision === "decline") await notify(transaction, actor.context.organisationId, row.person_id, "task.handover_declined", "Handover declined", `The handover was declined: ${row.title}.`, requestId, row.id, requestId);
      return { requestId, assignmentId: row.id, status: nextStatus };
    });
    if (result === "REQUEST_NOT_FOUND" || result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, 409);
    return json(result);
  } catch (error) {
    const databaseError = error as Error & { code?: string; constraint?: string };
    if (databaseError.code === "23505" && databaseError.constraint === "task_assignments_active_task_person") {
      return json({ error: "PERSON_ALREADY_ASSIGNED" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readHandoverRequests(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const requestId = parseCollaborationRequestIdFilter(request);
  if (requestId === undefined) return json({ error: "REQUEST_ID_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query<{
        id: string; assignment_id: string; requester_person_id: string; target_person_id: string;
        reason: string; status: string; created_at: Date; expires_at: Date; resolved_at: Date | null;
        title: string; task_id: string; task_status: string; assignment_status: string;
        assignment_person_id: string; client_id: string | null; client_workstream_id: string | null;
        work_group_id: string | null; actor_already_assigned: boolean; is_expired: boolean;
      }>(
        handoverRequestsReadSql,
        [actor.context.organisationId, actor.context.userId, requestId],
      );
      const requests = [];
      for (const row of rows.rows) {
        const isRecipient = row.target_person_id === actor.context.userId;
        const canCheckAcceptance = handoverRequestActionFlags({
          actorPersonId: actor.context.userId,
          requesterPersonId: row.requester_person_id,
          targetPersonId: row.target_person_id,
          assignmentPersonId: row.assignment_person_id,
          requestStatus: row.status,
          expired: row.is_expired,
          assignmentStatus: row.assignment_status,
          taskStatus: row.task_status,
          canReceiveAssignments: true,
          canAcceptTarget: true,
          alreadyAssigned: row.actor_already_assigned,
        }).canAccept;
        const target = {
          ...(row.client_id ? { clientId: row.client_id } : {}),
          ...(row.client_workstream_id ? { clientWorkstreamId: row.client_workstream_id } : {}),
          ...(row.work_group_id ? { groupId: row.work_group_id } : {}),
          taskId: row.task_id,
        };
        const canReceiveAssignments = canCheckAcceptance && await personCanReceiveAssignments(
          transaction, actor.context.userId, actor.context.organisationId,
        );
        const canAcceptTarget = canReceiveAssignments && await hasPermission(
          transaction,
          actor.context.userId,
          actor.context.organisationId,
          "tasks.handover_accept",
          target,
        );
        const { task_id: _taskId, task_status: _taskStatus, assignment_status: _assignmentStatus,
          assignment_person_id: _assignmentPersonId, client_id: _clientId,
          client_workstream_id: _clientWorkstreamId, work_group_id: _workGroupId,
          actor_already_assigned: _actorAlreadyAssigned, is_expired: _isExpired, ...requestData } = row;
        requests.push({
          ...requestData,
          isRecipient,
          ...handoverRequestActionFlags({
            actorPersonId: actor.context.userId,
            requesterPersonId: row.requester_person_id,
            targetPersonId: row.target_person_id,
            assignmentPersonId: row.assignment_person_id,
            requestStatus: row.status,
            expired: row.is_expired,
            assignmentStatus: row.assignment_status,
            taskStatus: row.task_status,
            canReceiveAssignments,
            canAcceptTarget,
            alreadyAssigned: row.actor_already_assigned,
          }),
        });
      }
      return requests;
    });
    return json({ requests: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
