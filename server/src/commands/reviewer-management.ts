import type { PoolClient } from "pg";
import { withDatabaseRequest } from "../db.js";
import {
  normalActor,
  permissionExistsSql,
  reviewerExceptionTargetEligible,
  type PermissionSqlReferences,
} from "./work-context.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pageLimit = 25;
const maxPageLimit = 50;
const managedScopes = ["organisation", "client_workstream", "group", "assigned_work"] as const;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

export type ReviewerManagementPage = Readonly<{
  limit: number;
  cursorAssignedAt: string | null;
  cursorAssignmentId: string | null;
}>;

export type ReviewerCandidatePage = Readonly<{
  limit: number;
  query: string;
  searchPattern: string | null;
  cursorName: string | null;
  cursorPersonId: string | null;
  cursorBinding: string;
}>;

function pageBinding(value: unknown): string {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validUtcTimestamp(value: string): boolean {
  const pattern = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}\+00$/;
  const iso = value.slice(0, 23).replace(" ", "T") + "Z";
  if (!pattern.test(value) || !Number.isFinite(Date.parse(iso))) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return date.toISOString().slice(0, 10) === value.slice(0, 10);
}

export function parseReviewerManagementPage(request: Request): ReviewerManagementPage | undefined {
  const params = new URL(request.url).searchParams;
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) return undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? pageLimit : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageLimit) return undefined;

  const rawCursor = params.get("cursor");
  if (!rawCursor) return { limit, cursorAssignedAt: null, cursorAssignmentId: null };
  const [assignedAt, assignmentId, binding, ...extra] = rawCursor.split("~");
  if (rawCursor.length > 160 || extra.length || !assignedAt || !validUtcTimestamp(assignedAt) ||
      !assignmentId || !uuidPattern.test(assignmentId) || binding !== pageBinding("reviewer-management-v1")) {
    return undefined;
  }
  return { limit, cursorAssignedAt: assignedAt, cursorAssignmentId: assignmentId };
}

export function parseReviewerCandidatePage(request: Request, assignmentId: string): ReviewerCandidatePage | undefined {
  const params = new URL(request.url).searchParams;
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1 || params.getAll("q").length > 1) return undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? pageLimit : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageLimit) return undefined;

  const query = params.get("q")?.trim() || "";
  if (query.length > 100) return undefined;
  const searchPattern = query
    ? `%${query.replace(/[\^%_]/g, "^$&")}%`
    : null;
  const cursorBinding = pageBinding(["reviewer-candidates-v1", assignmentId.toLowerCase(), query]);
  const rawCursor = params.get("cursor");
  if (!rawCursor) {
    return { limit, query, searchPattern, cursorName: null, cursorPersonId: null, cursorBinding };
  }

  const [encodedName, personId, binding, ...extra] = rawCursor.split("~");
  let cursorName: string;
  if (rawCursor.length > 2048) return undefined;
  try { cursorName = decodeURIComponent(encodedName ?? ""); }
  catch { return undefined; }
  if (extra.length || !encodedName || !cursorName || cursorName.length > 500 ||
      !personId || !uuidPattern.test(personId) || binding !== cursorBinding) return undefined;
  return { limit, query, searchPattern, cursorName, cursorPersonId: personId, cursorBinding };
}

function activeActorGrantsCte(actorId: string, organisationId: string): string {
  return `actor_business_date AS MATERIALIZED (
    SELECT nova.person_business_date(${actorId}) AS business_date
  ), active_grants AS MATERIALIZED (
    SELECT actor_date.business_date, grants.permission_key, grants.scope, grants.client_id,
           grants.client_workstream_id, grants.group_id, grants.office_id,
           grants.organisation_department_id
    FROM nova.person_role_assignments role_assignments
    CROSS JOIN actor_business_date actor_date
    JOIN nova.roles roles ON roles.id = role_assignments.role_id
      AND roles.organisation_id = ${organisationId}
    JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
    WHERE role_assignments.person_id = ${actorId}
      AND role_assignments.effective_on <= actor_date.business_date
      AND (role_assignments.effective_until IS NULL OR role_assignments.effective_until >= actor_date.business_date)
      AND roles.archived_at IS NULL
  )`;
}

function reviewerManagePermission(references: Partial<PermissionSqlReferences> & Pick<PermissionSqlReferences,
  "actorId" | "organisationId" | "clientId" | "clientWorkstreamId" | "groupId" | "taskId">): string {
  return permissionExistsSql({
    ...references,
    permissionKey: "'tasks.reviewer_manage'",
    allowedScopes: managedScopes,
    assignedWorkAssignmentId: references.assignedWorkAssignmentId,
  });
}

export const reviewerManagementListReadSql = `WITH ${activeActorGrantsCte("$1", "$2")}
SELECT assignments.id AS assignment_id, tasks.id AS task_id, tasks.title,
       assignments.status AS assignment_status, assignments.review_required,
       assignments.review_blocked_reason, assignees.display_name AS assignee_name,
       assignments.reviewer_person_id, reviewers.display_name AS reviewer_name,
       to_char(assignments.assigned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' AS cursor_assigned_at
FROM nova.task_assignments assignments
JOIN nova.tasks tasks ON tasks.id = assignments.task_id AND tasks.organisation_id = assignments.organisation_id
JOIN nova.people assignees ON assignees.id = assignments.person_id AND assignees.organisation_id = assignments.organisation_id
LEFT JOIN nova.people reviewers ON reviewers.id = assignments.reviewer_person_id AND reviewers.organisation_id = assignments.organisation_id
LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
  AND workstreams.organisation_id = tasks.organisation_id
LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
  AND clients.organisation_id = tasks.organisation_id
WHERE assignments.organisation_id = $2
  AND assignments.status NOT IN ('approved', 'cancelled')
  AND ${reviewerManagePermission({
    actorId: "$1", organisationId: "$2", clientId: "clients.id",
    clientWorkstreamId: "tasks.client_workstream_id", groupId: "tasks.work_group_id",
    taskId: "tasks.id", assignedWorkAssignmentId: "assignments.id",
  })}
  AND ($3::timestamptz IS NULL OR (assignments.assigned_at, assignments.id) < ($3::timestamptz, $4::uuid))
ORDER BY assignments.assigned_at DESC, assignments.id DESC
LIMIT $5`;

export const reviewerManagementFocusedReadSql = `WITH ${activeActorGrantsCte("$1", "$2")}
SELECT assignments.id AS assignment_id, tasks.id AS task_id, tasks.title,
       assignments.status AS assignment_status, assignments.review_required,
       assignments.review_blocked_reason, assignees.display_name AS assignee_name,
       assignments.reviewer_person_id, reviewers.display_name AS reviewer_name,
       ${reviewerManagePermission({
         actorId: "$1", organisationId: "$2", clientId: "clients.id",
         clientWorkstreamId: "tasks.client_workstream_id", groupId: "tasks.work_group_id",
         taskId: "tasks.id", assignedWorkAssignmentId: "assignments.id",
       })} AS permitted,
       clients.id AS client_id, tasks.client_workstream_id, tasks.work_group_id,
       assignments.person_id AS assignee_person_id
FROM nova.task_assignments assignments
JOIN nova.tasks tasks ON tasks.id = assignments.task_id AND tasks.organisation_id = assignments.organisation_id
JOIN nova.people assignees ON assignees.id = assignments.person_id AND assignees.organisation_id = assignments.organisation_id
LEFT JOIN nova.people reviewers ON reviewers.id = assignments.reviewer_person_id AND reviewers.organisation_id = assignments.organisation_id
LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
  AND workstreams.organisation_id = tasks.organisation_id
LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
  AND clients.organisation_id = tasks.organisation_id
WHERE assignments.organisation_id = $2 AND assignments.id = $3
LIMIT 1`;

const reviewerCandidateScope = permissionExistsSql({
  actorId: "candidate_people.id",
  grantPersonId: "candidate_people.id",
  grantsRelation: "candidate_active_grants",
  organisationId: "$1",
  permissionKey: "'tasks.review'",
  allowedScopes: ["organisation", "client", "client_workstream", "group", "assigned_work"],
  clientId: "$3::uuid",
  clientWorkstreamId: "$4::uuid",
  groupId: "$5::uuid",
  taskId: "$6::uuid",
});

export const reviewerEligibleCandidatesReadSql = `WITH candidate_people AS MATERIALIZED (
  SELECT people.id, people.display_name
  FROM nova.people people
  JOIN nova.person_status_periods statuses
    ON statuses.person_id = people.id AND statuses.ended_at IS NULL
  WHERE people.organisation_id = $1 AND people.id <> $2
    AND statuses.status IN ('active', 'notice')
    AND ($7::text IS NULL OR people.display_name ILIKE $7 ESCAPE '^')
), candidate_business_dates AS MATERIALIZED (
  SELECT candidate_people.id AS person_id, nova.person_business_date(candidate_people.id) AS business_date
  FROM candidate_people
), candidate_active_grants AS MATERIALIZED (
  SELECT candidate_dates.person_id, candidate_dates.business_date,
         grants.permission_key, grants.scope, grants.client_id, grants.client_workstream_id,
         grants.group_id, grants.office_id, grants.organisation_department_id
  FROM candidate_business_dates candidate_dates
  JOIN nova.person_role_assignments role_assignments ON role_assignments.person_id = candidate_dates.person_id
  JOIN nova.roles roles ON roles.id = role_assignments.role_id
    AND roles.organisation_id = $1
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE role_assignments.effective_on <= candidate_dates.business_date
    AND (role_assignments.effective_until IS NULL OR role_assignments.effective_until >= candidate_dates.business_date)
    AND roles.archived_at IS NULL
)
SELECT candidate_people.id, candidate_people.display_name
FROM candidate_people
WHERE ${reviewerCandidateScope}
  AND ($8::text IS NULL OR (candidate_people.display_name COLLATE "C", candidate_people.id) > ($8::text COLLATE "C", $9::uuid))
ORDER BY candidate_people.display_name COLLATE "C", candidate_people.id
LIMIT $10`;

export const reviewerExceptionCandidatesReadSql = `
SELECT people.id, people.display_name
FROM nova.people people
JOIN nova.person_status_periods statuses
  ON statuses.person_id = people.id AND statuses.ended_at IS NULL
WHERE people.organisation_id = $1 AND people.id <> $2
  AND statuses.status IN ('active', 'notice')
  AND ($3::text IS NULL OR people.display_name ILIKE $3 ESCAPE '^')
  AND ($4::text IS NULL OR (people.display_name COLLATE "C", people.id) > ($4::text COLLATE "C", $5::uuid))
ORDER BY people.display_name COLLATE "C", people.id
LIMIT $6`;

export const reviewerExceptionTargetReadSql = `
SELECT assignments.id AS assignment_id, assignments.person_id AS assignee_person_id,
       assignments.status AS assignment_status, assignments.review_required
FROM nova.task_assignments assignments
WHERE assignments.organisation_id = $1 AND assignments.id = $2
LIMIT 1`;

type ReviewerManagementRow = Readonly<{
  assignment_id: string;
  task_id: string;
  title: string;
  assignment_status: string;
  review_required: boolean;
  review_blocked_reason: string | null;
  assignee_name: string;
  reviewer_person_id: string | null;
  reviewer_name: string | null;
  cursor_assigned_at: string;
  permitted?: boolean;
  client_id?: string | null;
  client_workstream_id?: string | null;
  work_group_id?: string | null;
  assignee_person_id?: string;
}>;

type CandidateRow = Readonly<{ id: string; display_name: string }>;

export function projectReviewerManagementAssignment(row: ReviewerManagementRow) {
  return {
    assignmentId: row.assignment_id,
    taskTitle: row.title,
    status: row.assignment_status,
    assigneeName: row.assignee_name,
    reviewRequired: row.review_required,
    reviewBlockedReason: row.review_blocked_reason,
    currentReviewer: row.reviewer_person_id && row.reviewer_name
      ? { id: row.reviewer_person_id, displayName: row.reviewer_name }
      : null,
  };
}

function projectCandidates(rows: readonly CandidateRow[], filters: ReviewerCandidatePage) {
  const pageRows = rows.slice(0, filters.limit);
  const hasMore = rows.length > filters.limit;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? `${encodeURIComponent(last.display_name).replace(/~/g, "%7E")}~${last.id}~${filters.cursorBinding}`
    : null;
  return {
    items: pageRows.map((row) => ({ id: row.id, displayName: row.display_name })),
    hasMore,
    nextCursor,
    limit: filters.limit,
  };
}

function projectManagementPage(rows: readonly ReviewerManagementRow[], filters: ReviewerManagementPage) {
  const pageRows = rows.slice(0, filters.limit);
  const hasMore = rows.length > filters.limit;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? `${last.cursor_assigned_at}~${last.assignment_id}~${pageBinding("reviewer-management-v1")}`
    : null;
  return { assignments: pageRows.map(projectReviewerManagementAssignment), hasMore, nextCursor, limit: filters.limit };
}

async function hasReviewerManageGrant(transaction: PoolClient, actorId: string, organisationId: string): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments role_assignments
       CROSS JOIN LATERAL (SELECT nova.person_business_date($1) AS business_date) actor_date
       JOIN nova.roles roles ON roles.id = role_assignments.role_id
         AND roles.organisation_id = $2
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE role_assignments.person_id = $1
         AND EXISTS (SELECT 1 FROM nova.people actor WHERE actor.id = $1 AND actor.organisation_id = $2)
         AND role_assignments.effective_on <= actor_date.business_date
         AND (role_assignments.effective_until IS NULL OR role_assignments.effective_until >= actor_date.business_date)
         AND roles.archived_at IS NULL
         AND grants.permission_key = 'tasks.reviewer_manage'
         AND grants.scope = ANY(ARRAY['organisation','client_workstream','group','assigned_work']::nova.permission_scope[])
     ) AS permitted`,
    [actorId, organisationId],
  );
  return result.rows[0]?.permitted === true;
}

export async function readReviewerManagementList(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const filters = parseReviewerManagementPage(request);
  if (!filters) return json({ error: "REVIEWER_MANAGEMENT_QUERY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasReviewerManageGrant(transaction, actor.context.userId, actor.context.organisationId)) {
        return "PERMISSION_DENIED" as const;
      }
      const rows = await transaction.query<ReviewerManagementRow>(reviewerManagementListReadSql, [
        actor.context.userId,
        actor.context.organisationId,
        filters.cursorAssignedAt,
        filters.cursorAssignmentId,
        filters.limit + 1,
      ]);
      return projectManagementPage(rows.rows, filters);
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

async function readFocusedAssignment(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  assignmentId: string,
): Promise<ReviewerManagementRow | "ASSIGNMENT_NOT_FOUND" | "PERMISSION_DENIED" | "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE"> {
  const result = await transaction.query<ReviewerManagementRow>(reviewerManagementFocusedReadSql, [
    actorId, organisationId, assignmentId,
  ]);
  const row = result.rows[0];
  if (!row) return "ASSIGNMENT_NOT_FOUND";
  if (row.permitted !== true) return "PERMISSION_DENIED";
  if (["approved", "cancelled"].includes(row.assignment_status)) return "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE";
  return row;
}

async function readEligibleCandidates(
  transaction: PoolClient,
  organisationId: string,
  row: ReviewerManagementRow,
  filters: ReviewerCandidatePage,
) {
  const rows = await transaction.query<CandidateRow>(reviewerEligibleCandidatesReadSql, [
    organisationId,
    row.assignee_person_id,
    row.client_id ?? null,
    row.client_workstream_id ?? null,
    row.work_group_id ?? null,
    row.task_id,
    filters.searchPattern,
    filters.cursorName,
    filters.cursorPersonId,
    filters.limit + 1,
  ]);
  return projectCandidates(rows.rows, filters);
}

export async function readReviewerManagementAssignment(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  const filters = parseReviewerCandidatePage(request, assignmentId);
  if (!filters) return json({ error: "REVIEWER_CANDIDATE_QUERY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const row = await readFocusedAssignment(
        transaction, actor.context.userId, actor.context.organisationId, assignmentId,
      );
      if (typeof row === "string") return row;
      const eligibleReviewers = await readEligibleCandidates(transaction, actor.context.organisationId, row, filters);
      return { assignment: projectReviewerManagementAssignment(row), eligibleReviewers };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function readReviewerExceptionCandidates(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  const filters = parseReviewerCandidatePage(request, assignmentId);
  if (!filters) return json({ error: "REVIEWER_CANDIDATE_QUERY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const owner = await transaction.query<{ permitted: boolean }>(
        "SELECT nova.request_actor_is_super_admin() AS permitted",
      );
      if (owner.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      const target = await transaction.query<{
        assignment_id: string;
        assignee_person_id: string;
        assignment_status: string;
        review_required: boolean;
      }>(reviewerExceptionTargetReadSql, [actor.context.organisationId, assignmentId]);
      const row = target.rows[0];
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (!reviewerExceptionTargetEligible(row.assignment_status, row.review_required)) {
        return "ASSIGNMENT_NOT_EXCEPTION_ELIGIBLE" as const;
      }
      const rows = await transaction.query<CandidateRow>(reviewerExceptionCandidatesReadSql, [
        actor.context.organisationId,
        row.assignee_person_id,
        filters.searchPattern,
        filters.cursorName,
        filters.cursorPersonId,
        filters.limit + 1,
      ]);
      return projectCandidates(rows.rows, filters);
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "ASSIGNMENT_NOT_EXCEPTION_ELIGIBLE") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
