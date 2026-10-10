import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";
import { idempotent, isIdempotencyReplay, requestIdempotencyKey } from "../idempotency.js";
import { searchAuthorizedWorkContext } from "./work-context-search.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type Target = Readonly<{
  clientId?: string;
  clientWorkstreamId?: string;
  groupId?: string;
  taskId?: string;
  /** Limit assigned_work permission checks to one exact assignment when required. */
  assignmentId?: string;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function text(value: unknown, maximum = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= maximum ? result : undefined;
}

function id(value: unknown): string | undefined {
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

export function validTaskDueDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return false;
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

export type TaskBillingClass = "billable" | "non_billable";

export type OwnAssignmentActionState = Readonly<{
  status: string;
  taskStatus: string;
  canStartPermission: boolean;
  canSubmitPermission: boolean;
  canRequestReviewerPermission: boolean;
  canRequestHandoverPermission: boolean;
  hasPendingReviewerRequest: boolean;
  hasPendingHandoverRequest: boolean;
}>;

/**
 * Describe the actions that fit an actor's own assignment state. Permissions
 * are projected from effective target-scoped grants in the database query;
 * the corresponding write commands still repeat every check transactionally.
 */
export function ownAssignmentActionCapabilities(state: OwnAssignmentActionState) {
  const canStart = ["assigned", "in_progress", "changes_requested"].includes(state.status) &&
    ["backlog", "ready", "in_progress", "returned", "blocked"].includes(state.taskStatus);
  const canSubmit = ["in_progress", "changes_requested"].includes(state.status);
  const requestable = state.taskStatus !== "cancelled" &&
    !["cancelled", "approved"].includes(state.status);
  return {
    canStart: canStart && state.canStartPermission,
    canSubmit: canSubmit && state.canSubmitPermission,
    canRequestReviewer: requestable && state.canRequestReviewerPermission && !state.hasPendingReviewerRequest,
    canRequestHandover: requestable && state.canRequestHandoverPermission && !state.hasPendingHandoverRequest,
  };
}

export function taskCorrectionInput(value: Record<string, unknown>): {
  correctionOfTaskId: string | null;
  correctionReason: string | null;
} | undefined {
  const candidateTaskId = value.correctionOfTaskId;
  const hasTaskId = candidateTaskId !== undefined && candidateTaskId !== null && candidateTaskId !== "";
  const correctionOfTaskId = hasTaskId ? id(candidateTaskId) : undefined;
  if (hasTaskId && !correctionOfTaskId) return undefined;

  const candidateReason = value.correctionReason;
  const hasReason = candidateReason !== undefined && candidateReason !== null && candidateReason !== "";
  const correctionReason = hasReason ? text(candidateReason, 2000) : undefined;
  if (hasReason && !correctionReason) return undefined;
  if (Boolean(correctionOfTaskId) !== Boolean(correctionReason)) return undefined;

  return {
    correctionOfTaskId: correctionOfTaskId ?? null,
    correctionReason: correctionReason ?? null,
  };
}

export async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export type PermissionSqlReferences = Readonly<{
  actorId: string;
  organisationId: string;
  permissionKey: string;
  clientId: string;
  clientWorkstreamId: string;
  groupId: string;
  taskId: string;
  allowedScopes?: readonly ("organisation" | "client" | "client_workstream" | "group" | "assigned_work")[];
  /** Narrow assigned_work authorization to one exact assignment when the target is an assignment action. */
  assignedWorkAssignmentId?: string;
  /** Bind the grant scan to a person when active_grants contains candidates for multiple actors. */
  grantPersonId?: string;
  /** Permission-query CTE name; callers must supply a fixed internal identifier. */
  grantsRelation?: string;
}>;

export function permissionExistsSql(ref: PermissionSqlReferences): string {
  const allowedScopes = ref.allowedScopes
    ? `AND grants.scope = ANY(ARRAY[${ref.allowedScopes.map((scope) => `'${scope}'`).join(", ")}]::nova.permission_scope[])`
    : "";
  return `EXISTS (
    SELECT 1
    FROM ${ref.grantsRelation ?? "active_grants"} grants
    WHERE grants.permission_key = ${ref.permissionKey}
      ${ref.grantPersonId ? `AND grants.person_id = ${ref.grantPersonId}` : ""}
      ${allowedScopes}
      AND (
        grants.scope = 'organisation'
        OR (grants.scope = 'client' AND grants.client_id = ${ref.clientId})
        OR (grants.scope = 'client_workstream' AND grants.client_workstream_id = ${ref.clientWorkstreamId})
        OR (grants.scope = 'group' AND grants.group_id = ${ref.groupId})
        OR (grants.scope = 'office' AND EXISTS (
          SELECT 1 FROM nova.person_office_assignments actor_offices
          WHERE actor_offices.person_id = ${ref.actorId}
            AND actor_offices.office_id = grants.office_id
            AND actor_offices.effective_on <= grants.business_date
            AND (actor_offices.effective_until IS NULL OR actor_offices.effective_until >= grants.business_date)
        ))
        OR (grants.scope = 'organisation_department' AND EXISTS (
          SELECT 1 FROM nova.person_department_assignments actor_departments
          WHERE actor_departments.person_id = ${ref.actorId}
            AND actor_departments.organisation_department_id = grants.organisation_department_id
            AND actor_departments.effective_on <= grants.business_date
            AND (actor_departments.effective_until IS NULL OR actor_departments.effective_until >= grants.business_date)
        ))
        OR (grants.scope = 'assigned_work' AND EXISTS (
          SELECT 1 FROM nova.task_assignments actor_assignments
          WHERE actor_assignments.task_id = ${ref.taskId}
            AND actor_assignments.organisation_id = ${ref.organisationId}
            ${ref.assignedWorkAssignmentId ? `AND actor_assignments.id = ${ref.assignedWorkAssignmentId}` : ""}
            AND (actor_assignments.person_id = ${ref.actorId}
                 OR (grants.permission_key = 'tasks.review'
                     AND (actor_assignments.reviewer_person_id = ${ref.actorId}
                          OR EXISTS (
                            SELECT 1 FROM nova.task_reviewer_requests reviewer_requests
                            WHERE reviewer_requests.assignment_id = actor_assignments.id
                              AND reviewer_requests.candidate_reviewer_person_id = ${ref.actorId}
                              AND reviewer_requests.status = 'pending'
                              AND reviewer_requests.expires_at > clock_timestamp()
                          )))
                 OR (grants.permission_key = 'tasks.handover_accept'
                     AND EXISTS (
                       SELECT 1 FROM nova.task_assignment_handover_requests handovers
                       WHERE handovers.assignment_id = actor_assignments.id
                         AND handovers.target_person_id = ${ref.actorId}
                         AND handovers.status = 'pending'
                         AND handovers.expires_at > clock_timestamp()
                     )))
        ))
      )
  )`;
}

function activeActorGrantCtes(actorId: "$1" | "$2"): string {
  return `WITH actor_business_date AS MATERIALIZED (
     SELECT nova.person_business_date(${actorId}) AS business_date
   ), active_grants AS MATERIALIZED (
     SELECT actor_date.business_date, grants.permission_key, grants.scope, grants.client_id,
            grants.client_workstream_id, grants.group_id, grants.office_id,
            grants.organisation_department_id
     FROM nova.person_role_assignments assignments
     CROSS JOIN actor_business_date actor_date
     JOIN nova.roles roles ON roles.id = assignments.role_id
     JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
     WHERE assignments.person_id = ${actorId}
       AND assignments.effective_on <= actor_date.business_date
       AND (assignments.effective_until IS NULL OR assignments.effective_until >= actor_date.business_date)
       AND roles.archived_at IS NULL
   )`;
}

/** An exception is meaningful only when this assignment actually requires review. */
export function reviewerExceptionTargetEligible(status: string, reviewRequired: boolean): boolean {
  return reviewRequired && !["approved", "cancelled"].includes(status);
}

export function exactReviewerManagementTarget(assignmentId: string, taskId: string, target: Target): Target {
  return { ...target, taskId, assignmentId };
}

export const reviewerExceptionGrantTargetSql = `SELECT assignments.id, assignments.task_id, assignments.person_id,
       assignments.status, assignments.review_required, tasks.title
FROM nova.task_assignments assignments
JOIN nova.tasks tasks ON tasks.id = assignments.task_id
WHERE assignments.id = $1 AND assignments.organisation_id = $2
FOR UPDATE OF assignments, tasks`;

/** Task-scoped grants used to present controls on the actor's own assignments. */
export function ownAssignmentActionPermissionSql() {
  const permission = (permissionKey: string) => permissionExistsSql({
    actorId: "$2",
    organisationId: "$1",
    permissionKey: `'${permissionKey}'`,
    clientId: "candidate_assignments.client_id",
    clientWorkstreamId: "candidate_assignments.client_workstream_id",
    groupId: "candidate_assignments.work_group_id",
    taskId: "candidate_assignments.task_id",
  });
  return {
    canStart: permission("tasks.start"),
    canSubmit: permission("tasks.submit"),
    canRequestReviewer: permission("tasks.reviewer_request"),
    canRequestHandover: permission("tasks.handover_request"),
  };
}

export async function hasPermission(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  permissionKey: string,
  target: Target = {},
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `${activeActorGrantCtes("$1")}
     SELECT ${permissionExistsSql({
      actorId: "$1",
      organisationId: "$2",
      permissionKey: "$3",
      clientId: "$4",
      clientWorkstreamId: "$5",
      groupId: "$6",
      taskId: "$7",
      assignedWorkAssignmentId: target.assignmentId ? "$8" : undefined,
    })} AS permitted`,
    [actorId, organisationId, permissionKey, target.clientId ?? null,
      target.clientWorkstreamId ?? null, target.groupId ?? null, target.taskId ?? null,
      ...(target.assignmentId ? [target.assignmentId] : [])],
  );
  return result.rows[0]?.permitted === true;
}

export async function hasPermissions(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  permissionKeys: readonly string[],
  target: Target = {},
): Promise<Record<string, boolean>> {
  if (!permissionKeys.length) return {};

  const targetParameter = permissionKeys.length + 3;
  const projections = permissionKeys.map((_, index) => `${permissionExistsSql({
    actorId: "$1",
    organisationId: "$2",
    permissionKey: `$${index + 3}`,
    clientId: `$${targetParameter}`,
    clientWorkstreamId: `$${targetParameter + 1}`,
    groupId: `$${targetParameter + 2}`,
    taskId: `$${targetParameter + 3}`,
    assignedWorkAssignmentId: target.assignmentId ? `$${targetParameter + 4}` : undefined,
  })} AS permission_${index}`).join(",\n");
  const values = [
    actorId,
    organisationId,
    ...permissionKeys,
    target.clientId ?? null,
    target.clientWorkstreamId ?? null,
    target.groupId ?? null,
    target.taskId ?? null,
    ...(target.assignmentId ? [target.assignmentId] : []),
  ];
  const result = await transaction.query<Record<string, boolean>>(
    `${activeActorGrantCtes("$1")} SELECT ${projections}`,
    values,
  );
  const row = result.rows[0] ?? {};
  return Object.fromEntries(permissionKeys.map((key, index) => [key, row[`permission_${index}`] === true]));
}

function workContextGrantCtes(): string {
  return activeActorGrantCtes("$2");
}

export function workContextPermissionSql(
  permissionKey: string,
  target: {
    clientId?: string;
    clientWorkstreamId?: string;
    groupId?: string;
    allowedScopes?: PermissionSqlReferences["allowedScopes"];
  },
): string {
  return permissionExistsSql({
    actorId: "$2",
    organisationId: "$1",
    permissionKey: `'${permissionKey}'`,
    clientId: target.clientId ?? "NULL::uuid",
    clientWorkstreamId: target.clientWorkstreamId ?? "NULL::uuid",
    groupId: target.groupId ?? "NULL::uuid",
    taskId: "NULL::uuid",
    allowedScopes: target.allowedScopes,
  });
}

export function workContextClientIsVisible(row: {
  can_view: boolean;
  can_create_workstream: boolean;
}): boolean {
  return row.can_view || row.can_create_workstream;
}

export function workContextWorkstreamIsVisible(row: {
  can_view_workstream: boolean;
  can_manage_billing_policy?: boolean;
  can_create_group: boolean;
}): boolean {
  return row.can_view_workstream || row.can_manage_billing_policy === true || row.can_create_group;
}

export function workContextSearchPattern(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  return `%${trimmed.replaceAll("^", "^^").replaceAll("%", "^%").replaceAll("_", "^_")}%`;
}

function workContextSearchMatch(expression: string): string {
  return `${expression} ILIKE $3 ESCAPE '^'`;
}

function workContextSearchAny(...expressions: string[]): string {
  return `(${expressions.map(workContextSearchMatch).join(" OR ")})`;
}

export type TaskPermissionHints = Readonly<{
  canView: boolean;
  /** Broad task visibility; assigned_work alone must never expose a task roster. */
  canViewBroad: boolean;
  canEditDueDate: boolean;
  canAssign: boolean;
  canCancel: boolean;
  canReassign: boolean;
}>;

/**
 * Project the exact task-scoped permissions in one query so list responses can
 * hide controls without doing one permission round-trip per action/assignment.
 * Commands still recheck every permission before writing.
 */
export async function readTaskPermissionHints(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  target: Target,
): Promise<TaskPermissionHints> {
  const references = (permissionKey: string): PermissionSqlReferences => ({
    actorId: "$1",
    organisationId: "$2",
    permissionKey: `'${permissionKey}'`,
    clientId: "$3",
    clientWorkstreamId: "$4",
    groupId: "$5",
    taskId: "$6",
  });
  const result = await transaction.query<{
    can_view: boolean;
    can_view_broad: boolean;
    can_edit_due_date: boolean;
    can_assign: boolean;
    can_cancel: boolean;
    can_reassign: boolean;
  }>(
    `WITH actor_business_date AS MATERIALIZED (
       SELECT nova.person_business_date($1) AS business_date
     ), active_grants AS MATERIALIZED (
       SELECT actor_date.business_date, grants.permission_key, grants.scope, grants.client_id,
              grants.client_workstream_id, grants.group_id, grants.office_id,
              grants.organisation_department_id
       FROM nova.person_role_assignments assignments
       CROSS JOIN actor_business_date actor_date
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= actor_date.business_date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= actor_date.business_date)
         AND roles.archived_at IS NULL
     )
     SELECT ${permissionExistsSql(references("tasks.view"))} AS can_view,
            ${permissionExistsSql({
              ...references("tasks.view"),
              allowedScopes: ["organisation", "client", "client_workstream", "group"],
            })} AS can_view_broad,
            ${permissionExistsSql(references("tasks.edit"))} AS can_edit_due_date,
            ${permissionExistsSql(references("tasks.assign"))} AS can_assign,
            ${permissionExistsSql(references("tasks.edit"))} AS can_cancel,
            ${permissionExistsSql(references("tasks.reassign"))} AS can_reassign`,
    [actorId, organisationId, target.clientId ?? null,
      target.clientWorkstreamId ?? null, target.groupId ?? null, target.taskId ?? null],
  );
  const row = result.rows[0];
  return {
    canView: row?.can_view === true,
    canViewBroad: row?.can_view_broad === true,
    canEditDueDate: row?.can_edit_due_date === true,
    canAssign: row?.can_assign === true,
    canCancel: row?.can_cancel === true,
    canReassign: row?.can_reassign === true,
  };
}

async function hasAnyPermission(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  permissionKeys: readonly string[],
  target: Target = {},
): Promise<boolean> {
  for (const permissionKey of permissionKeys) {
    if (await hasPermission(transaction, actorId, organisationId, permissionKey, target)) return true;
  }
  return false;
}

export async function personIsOperational(
  transaction: PoolClient,
  personId: string,
  organisationId: string,
): Promise<boolean> {
  const result = await transaction.query<{ operational: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.people people
       JOIN nova.person_status_periods statuses
         ON statuses.person_id = people.id AND statuses.ended_at IS NULL
       WHERE people.id = $1
         AND people.organisation_id = $2
         AND statuses.status IN ('active', 'notice')
     ) AS operational`,
    [personId, organisationId],
  );
  return result.rows[0]?.operational === true;
}

export async function personCanReceiveAssignments(
  transaction: PoolClient,
  personId: string,
  organisationId: string,
): Promise<boolean> {
  const result = await transaction.query<{ eligible: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.people people
       JOIN nova.person_status_periods statuses
         ON statuses.person_id = people.id AND statuses.ended_at IS NULL
       JOIN nova.person_role_assignments assignments
         ON assignments.person_id = people.id
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_operational_policies policies ON policies.role_id = roles.id
       WHERE people.id = $1
         AND people.organisation_id = $2
         AND statuses.status IN ('active', 'notice')
         AND assignments.effective_on <= nova.person_business_date(people.id)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
         AND roles.archived_at IS NULL
         AND policies.can_receive_assignments
     ) AS eligible`,
    [personId, organisationId],
  );
  return result.rows[0]?.eligible === true;
}

export async function audit(
  transaction: PoolClient,
  organisationId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: unknown = {},
): Promise<void> {
  await transaction.query(
    `INSERT INTO nova.audit_events (
      organisation_id, actor_person_id, action, target_type, target_id, details
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [organisationId, actorId, action, targetType, targetId, JSON.stringify(details)],
  );
}

function permissionDenied(result: unknown): Response | undefined {
  return result === "PERMISSION_DENIED" ? json({ error: result }, 403) : undefined;
}

export async function personCanReviewTarget(
  transaction: PoolClient,
  personId: string,
  organisationId: string,
  target: Target,
): Promise<boolean> {
  return await personIsOperational(transaction, personId, organisationId)
    && await hasPermission(transaction, personId, organisationId, "tasks.review", target);
}

export type TaskAssignmentOption = Readonly<{ id: string; name: string }>;

/**
 * Resolve narrowly scoped assignee/reviewer options for a single task. The
 * caller must have assignment or reassignment authority on this exact task;
 * candidates are filtered through the same domain eligibility checks used by
 * the write commands.
 */
export async function resolveTaskAssignmentOptions(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  taskId: string,
  search = "",
): Promise<{
  assignees: TaskAssignmentOption[];
  reviewers: TaskAssignmentOption[];
} | "TASK_NOT_FOUND" | "PERMISSION_DENIED"> {
  const taskResult = await transaction.query<{
    id: string;
    client_id: string | null;
    client_workstream_id: string | null;
    work_group_id: string | null;
  }>(
    `SELECT tasks.id, clients.id AS client_id, tasks.client_workstream_id,
            tasks.work_group_id
     FROM nova.tasks tasks
     LEFT JOIN nova.client_workstreams workstreams
       ON workstreams.id = tasks.client_workstream_id
     LEFT JOIN nova.clients clients
       ON clients.id = workstreams.client_id
     WHERE tasks.id = $1 AND tasks.organisation_id = $2`,
    [taskId, organisationId],
  );
  const task = taskResult.rows[0];
  if (!task) return "TASK_NOT_FOUND";

  const target: Target = {
    ...(task.client_id ? { clientId: task.client_id } : {}),
    ...(task.client_workstream_id ? { clientWorkstreamId: task.client_workstream_id } : {}),
    ...(task.work_group_id ? { groupId: task.work_group_id } : {}),
    taskId: task.id,
  };
  const permissionReferences = (permissionKey: string): PermissionSqlReferences => ({
    actorId: "$1",
    organisationId: "$2",
    permissionKey: `'${permissionKey}'`,
    clientId: "$3",
    clientWorkstreamId: "$4",
    groupId: "$5",
    taskId: "$6",
  });
  const permissions = await transaction.query<{ can_assign: boolean; can_reassign: boolean }>(
    `${activeActorGrantCtes("$1")}
     SELECT ${permissionExistsSql(permissionReferences("tasks.assign"))} AS can_assign,
            ${permissionExistsSql(permissionReferences("tasks.reassign"))} AS can_reassign`,
    [actorId, organisationId, target.clientId ?? null, target.clientWorkstreamId ?? null,
      target.groupId ?? null, target.taskId ?? null],
  );
  if (permissions.rows[0]?.can_assign !== true && permissions.rows[0]?.can_reassign !== true) {
    return "PERMISSION_DENIED";
  }

  const candidates = await transaction.query<{ kind: "assignee" | "reviewer"; id: string; name: string }>(
    taskAssignmentOptionCandidatesSql(),
    [organisationId, target.clientId ?? null, target.clientWorkstreamId ?? null,
      target.groupId ?? null, target.taskId ?? null, search.toLowerCase()],
  );
  return {
    assignees: candidates.rows.filter((candidate) => candidate.kind === "assignee")
      .map(({ id, name }) => ({ id, name })),
    reviewers: candidates.rows.filter((candidate) => candidate.kind === "reviewer")
      .map(({ id, name }) => ({ id, name })),
  };
}

/** Build bounded candidate lists from effective grants in one database read. */
export function taskAssignmentOptionCandidatesSql(): string {
  const reviewPermission = permissionExistsSql({
    actorId: "candidate_people.id",
    grantPersonId: "candidate_people.id",
    grantsRelation: "candidate_active_grants",
    organisationId: "$1",
    permissionKey: "'tasks.review'",
    clientId: "$2::uuid",
    clientWorkstreamId: "$3::uuid",
    groupId: "$4::uuid",
    taskId: "$5::uuid",
  });
  return `WITH candidate_people AS MATERIALIZED (
    SELECT people.id, people.display_name,
           nova.person_business_date(people.id) AS business_date
    FROM nova.people people
    JOIN nova.person_status_periods statuses
      ON statuses.person_id = people.id AND statuses.ended_at IS NULL
    WHERE people.organisation_id = $1
      AND statuses.status IN ('active', 'notice')
      AND ($6 = '' OR position($6 in lower(coalesce(people.display_name, ''))) > 0)
  ), candidate_active_grants AS MATERIALIZED (
    SELECT grants.person_id, candidate_people.business_date,
           grants.permission_key, grants.scope, grants.client_id,
           grants.client_workstream_id, grants.group_id, grants.office_id,
           grants.organisation_department_id
    FROM candidate_people
    JOIN nova.person_role_assignments assignments
      ON assignments.person_id = candidate_people.id
    JOIN nova.roles roles ON roles.id = assignments.role_id
      AND roles.organisation_id = $1 AND roles.archived_at IS NULL
    JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
    WHERE assignments.effective_on <= candidate_people.business_date
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= candidate_people.business_date)
  ), candidate_eligibility AS MATERIALIZED (
    SELECT candidate_people.id, candidate_people.display_name,
           EXISTS (
             SELECT 1
             FROM nova.person_role_assignments assignments
             JOIN nova.roles roles ON roles.id = assignments.role_id
               AND roles.organisation_id = $1 AND roles.archived_at IS NULL
             JOIN nova.role_operational_policies policies ON policies.role_id = roles.id
             WHERE assignments.person_id = candidate_people.id
               AND assignments.effective_on <= candidate_people.business_date
               AND (assignments.effective_until IS NULL OR assignments.effective_until >= candidate_people.business_date)
               AND policies.can_receive_assignments
           ) AS can_receive,
           ${reviewPermission} AS can_review
    FROM candidate_people
  ), assignee_options AS (
    SELECT id, display_name FROM candidate_eligibility
    WHERE can_receive ORDER BY lower(display_name), id LIMIT 100
  ), reviewer_options AS (
    SELECT id, display_name FROM candidate_eligibility
    WHERE can_review ORDER BY lower(display_name), id LIMIT 100
  )
  SELECT 'assignee'::text AS kind, id, display_name AS name FROM assignee_options
  UNION ALL
  SELECT 'reviewer'::text AS kind, id, display_name AS name FROM reviewer_options`;
}

export function parseTaskAssignmentOptionSearch(request: Request): string | undefined {
  const values = new URL(request.url).searchParams.getAll("q");
  if (values.length > 1) return undefined;
  const query = (values[0] || "").trim();
  return query.length <= 100 ? query : undefined;
}

export async function readTaskAssignmentOptions(request: Request, taskId: string): Promise<Response> {
  const search = parseTaskAssignmentOptionSearch(request);
  if (search === undefined) return json({ error: "TASK_ASSIGNMENT_OPTIONS_SEARCH_INPUT_INVALID" }, 400);
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(taskId)) return json({ error: "TASK_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, (transaction) =>
      resolveTaskAssignmentOptions(
        transaction,
        actor.context.userId,
        actor.context.organisationId,
        taskId,
        search,
      ),
    );
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "TASK_NOT_FOUND") return json({ error: result }, 404);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function createClient(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  const name = text(input.name);
  if (!name) return json({ error: "CLIENT_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "clients.create", requestKey, input, async () => {
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "clients.create")) return "PERMISSION_DENIED" as const;
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
           VALUES ($1, $2, $3) RETURNING id`,
          [actor.context.organisationId, name, actor.context.userId],
        );
        const clientId = created.rows[0]?.id;
        if (!clientId) throw new Error("CLIENT_CREATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId, "clients.create", "client", clientId, { name });
        return { clientId };
      });
    });
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    const denied = permissionDenied(result); if (denied) return denied;
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "CLIENT_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createClientWorkstream(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  const clientId = id(input.clientId);
  const name = text(input.name);
  if (!clientId || !name) return json({ error: "WORKSTREAM_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "workstreams.create.client", requestKey, input, async () => {
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "workstreams.create", { clientId })) return "PERMISSION_DENIED" as const;
        const client = await transaction.query<{ id: string }>(
          "SELECT id FROM nova.clients WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL FOR SHARE",
          [clientId, actor.context.organisationId],
        );
        if (!client.rows[0]) return "CLIENT_NOT_FOUND" as const;
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [actor.context.organisationId, clientId, name, actor.context.userId],
        );
        const workstreamId = created.rows[0]?.id;
        if (!workstreamId) throw new Error("WORKSTREAM_CREATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId, "workstreams.create", "client_workstream", workstreamId, { client_id: clientId, name });
        return { workstreamId };
      });
    });
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "CLIENT_NOT_FOUND") return json({ error: result }, 404);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "WORKSTREAM_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateClientWorkstreamBillingPolicy(request: Request, workstreamId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(workstreamId)) return json({ error: "WORKSTREAM_NOT_FOUND" }, 404);
  const input = await body(request);
  const policyClass = input.policyClass;
  const reason = text(input.reason, 2000);
  const expectedRevision = input.expectedRevision;
  if ((policyClass !== "billable" && policyClass !== "non_billable") ||
      typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !reason ||
      Object.hasOwn(input, "billingClass") || Object.hasOwn(input, "billing_class")) {
    return json({ error: "WORKSTREAM_BILLING_POLICY_INPUT_INVALID" }, 400);
  }
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) =>
      idempotent(transaction, actor.context, "workstreams.billing_policy.update", requestKey, input, async () => {
        const current = await transaction.query<{
          client_id: string; billing_policy_class: TaskBillingClass | null;
          billing_policy_revision: number; archived_at: Date | null;
        }>(
          `SELECT workstreams.client_id, workstreams.billing_policy_class,
                  workstreams.billing_policy_revision, workstreams.archived_at
           FROM nova.client_workstreams workstreams
           JOIN nova.clients clients
             ON clients.id = workstreams.client_id
            AND clients.organisation_id = workstreams.organisation_id
           WHERE workstreams.id = $1 AND workstreams.organisation_id = $2
             AND clients.archived_at IS NULL
           FOR UPDATE OF workstreams, clients`,
          [workstreamId, actor.context.organisationId],
        );
        const workstream = current.rows[0];
        if (!workstream || workstream.archived_at) return "WORKSTREAM_NOT_FOUND" as const;
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId,
          "workstreams.billing_policy.manage", {
            clientId: workstream.client_id, clientWorkstreamId: workstreamId,
          })) return "PERMISSION_DENIED" as const;
        if (workstream.billing_policy_revision !== expectedRevision) return "WORKSTREAM_BILLING_POLICY_VERSION_CONFLICT" as const;
        if (workstream.billing_policy_class === policyClass) {
          return { status: 200, body: {
            workstreamId, policyClass, revision: workstream.billing_policy_revision, changed: false,
          } };
        }
        const updated = await transaction.query<{ billing_policy_revision: number; billing_policy_set_at: Date }>(
          `UPDATE nova.client_workstreams
           SET billing_policy_class = $2::nova.task_billing_class
           WHERE id = $1 AND organisation_id = $3
           RETURNING billing_policy_revision, billing_policy_set_at`,
          [workstreamId, policyClass, actor.context.organisationId],
        );
        const saved = updated.rows[0];
        if (!saved) throw new Error("WORKSTREAM_BILLING_POLICY_UPDATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "workstreams.billing_policy.updated", "client_workstream", workstreamId, {
            previousPolicyClass: workstream.billing_policy_class,
            policyClass,
            revision: saved.billing_policy_revision,
            appliesTo: "future_tasks_only",
            reason,
          });
        return { status: 200, body: {
          workstreamId, policyClass, revision: saved.billing_policy_revision,
          changed: true, updatedAt: saved.billing_policy_set_at.toISOString(),
        } };
      }),
    );
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "WORKSTREAM_NOT_FOUND") return json({ error: result }, 404);
    if (result === "WORKSTREAM_BILLING_POLICY_VERSION_CONFLICT") return json({ error: result }, 409);
    return json(result.body, result.status);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readClientWorkstreamTaskBillingRules(request: Request, workstreamId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(workstreamId)) return json({ error: "WORKSTREAM_NOT_FOUND" }, 404);
  const searchParams = new URL(request.url).searchParams;
  const searchTerms = searchParams.getAll("q");
  const search = (searchTerms[0] || "").trim().toLowerCase();
  if (searchTerms.length > 1 || search.length > 100) {
    return json({ error: "BILLING_POLICY_SEARCH_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const workstreamResult = await transaction.query<{
        id: string; client_id: string; name: string; billing_policy_class: TaskBillingClass | null;
        billing_policy_revision: number; archived_at: Date | null;
      }>(
          `SELECT workstreams.id, workstreams.client_id, workstreams.name,
                  workstreams.billing_policy_class, workstreams.billing_policy_revision,
                  workstreams.archived_at
           FROM nova.client_workstreams workstreams
           JOIN nova.clients clients
             ON clients.id = workstreams.client_id
            AND clients.organisation_id = workstreams.organisation_id
           WHERE workstreams.id = $1 AND workstreams.organisation_id = $2
             AND clients.archived_at IS NULL`,
        [workstreamId, actor.context.organisationId],
      );
      const workstream = workstreamResult.rows[0];
      if (!workstream || workstream.archived_at) return "WORKSTREAM_NOT_FOUND" as const;
      const target = { clientId: workstream.client_id, clientWorkstreamId: workstream.id };
      const canManagePolicy = await hasPermission(
        transaction, actor.context.userId, actor.context.organisationId,
        "workstreams.billing_policy.manage", target,
      );
      const canViewCatalog = await hasPermission(
        transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.view",
      ) || await hasPermission(
        transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage",
      );
      if (!canManagePolicy || !canViewCatalog) return "PERMISSION_DENIED" as const;
      const entries = await transaction.query<{
        id: string; title: string; description: string | null; priority: string; catalog_revision: number;
        billing_class: TaskBillingClass | null; rule_revision: number | null;
      }>(
        `SELECT entries.id, entries.title, entries.description, entries.priority,
                entries.revision AS catalog_revision,
                rules.billing_class, rules.revision AS rule_revision
         FROM nova.task_catalog_entries entries
         LEFT JOIN nova.client_workstream_task_billing_rules rules
           ON rules.organisation_id = entries.organisation_id
          AND rules.client_workstream_id = $2
          AND rules.task_catalog_entry_id = entries.id
         WHERE entries.organisation_id = $1 AND entries.archived_at IS NULL
           AND ($3 = '' OR position($3 in lower(entries.title)) > 0)
         ORDER BY lower(entries.title), entries.id
         LIMIT 500`,
        [actor.context.organisationId, workstream.id, search],
      );
      return {
        workstreamId: workstream.id,
        defaultClass: workstream.billing_policy_class,
        defaultRevision: workstream.billing_policy_revision,
        entries: entries.rows.map((entry) => ({
          entryId: entry.id,
          title: entry.title,
          description: entry.description,
          priority: entry.priority,
          catalogRevision: entry.catalog_revision,
          billingClass: entry.billing_class,
          ruleRevision: entry.rule_revision ?? 0,
        })),
      };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "WORKSTREAM_NOT_FOUND") return json({ error: result }, 404);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateClientWorkstreamTaskBillingRule(
  request: Request,
  workstreamId: string,
  taskCatalogEntryId: string,
): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(workstreamId)) return json({ error: "WORKSTREAM_NOT_FOUND" }, 404);
  if (!uuidPattern.test(taskCatalogEntryId)) return json({ error: "TASK_CATALOG_ENTRY_NOT_FOUND" }, 404);
  const input = await body(request);
  const policyClass = input.policyClass;
  const expectedRevision = input.expectedRevision;
  const reason = text(input.reason, 2000);
  if (!Object.hasOwn(input, "policyClass") ||
      (policyClass !== null && policyClass !== "billable" && policyClass !== "non_billable") ||
      typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !reason || Object.hasOwn(input, "billingClass") || Object.hasOwn(input, "billing_class")) {
    return json({ error: "TASK_BILLING_RULE_INPUT_INVALID" }, 400);
  }
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) =>
      idempotent(transaction, actor.context, "workstreams.billing_policy.definition.update", requestKey, input, async () => {
        const currentWorkstream = await transaction.query<{
          client_id: string; archived_at: Date | null; billing_policy_class: TaskBillingClass | null;
        }>(
          `SELECT workstreams.client_id, workstreams.archived_at,
                  workstreams.billing_policy_class
           FROM nova.client_workstreams workstreams
           JOIN nova.clients clients
             ON clients.id = workstreams.client_id
            AND clients.organisation_id = workstreams.organisation_id
           WHERE workstreams.id = $1 AND workstreams.organisation_id = $2
             AND clients.archived_at IS NULL
           FOR UPDATE OF workstreams, clients`,
          [workstreamId, actor.context.organisationId],
        );
        const workstream = currentWorkstream.rows[0];
        if (!workstream || workstream.archived_at) return "WORKSTREAM_NOT_FOUND" as const;
        const target = { clientId: workstream.client_id, clientWorkstreamId: workstreamId };
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId,
          "workstreams.billing_policy.manage", target)) return "PERMISSION_DENIED" as const;
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId,
          "tasks.catalog.view") && !await hasPermission(
          transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage",
        )) return "PERMISSION_DENIED" as const;
        if (!workstream.billing_policy_class) return "TASK_BILLING_POLICY_NOT_CONFIGURED" as const;
        const definitionResult = await transaction.query<{ title: string; archived_at: Date | null }>(
          `SELECT title, archived_at
           FROM nova.task_catalog_entries
           WHERE id = $1 AND organisation_id = $2
           FOR SHARE`,
          [taskCatalogEntryId, actor.context.organisationId],
        );
        const definition = definitionResult.rows[0];
        if (!definition) return "TASK_CATALOG_ENTRY_NOT_FOUND" as const;
        if (definition.archived_at) return "TASK_CATALOG_ENTRY_ARCHIVED" as const;
        const selectedRule = await transaction.query<{
          billing_class: TaskBillingClass | null; revision: number;
        }>(
          `SELECT billing_class, revision
           FROM nova.client_workstream_task_billing_rules
           WHERE organisation_id = $1 AND client_workstream_id = $2 AND task_catalog_entry_id = $3
           FOR UPDATE`,
          [actor.context.organisationId, workstreamId, taskCatalogEntryId],
        );
        const rule = selectedRule.rows[0];
        const currentRevision = rule?.revision ?? 0;
        const currentClass = rule?.billing_class ?? null;
        if (currentRevision !== expectedRevision) return "TASK_BILLING_RULE_VERSION_CONFLICT" as const;
        if (currentClass === policyClass) {
          return { status: 200, body: {
            workstreamId, entryId: taskCatalogEntryId, policyClass,
            revision: currentRevision, changed: false,
          } };
        }
        if (!rule && policyClass === null) {
          return { status: 200, body: {
            workstreamId, entryId: taskCatalogEntryId, policyClass: null,
            revision: 0, changed: false,
          } };
        }
        let revision: number | undefined;
        if (!rule) {
          const created = await transaction.query<{ revision: number }>(
            `INSERT INTO nova.client_workstream_task_billing_rules (
               organisation_id, client_workstream_id, task_catalog_entry_id, billing_class
             ) VALUES ($1, $2, $3, $4::nova.task_billing_class)
             RETURNING revision`,
            [actor.context.organisationId, workstreamId, taskCatalogEntryId, policyClass],
          );
          revision = created.rows[0]?.revision;
        } else {
          const updated = await transaction.query<{ revision: number }>(
            `UPDATE nova.client_workstream_task_billing_rules
             SET billing_class = $4::nova.task_billing_class
             WHERE organisation_id = $1 AND client_workstream_id = $2 AND task_catalog_entry_id = $3
             RETURNING revision`,
            [actor.context.organisationId, workstreamId, taskCatalogEntryId, policyClass],
          );
          revision = updated.rows[0]?.revision;
        }
        if (!revision) throw new Error("TASK_BILLING_RULE_UPDATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "workstreams.billing_policy.definition_updated", "task_catalog_entry", taskCatalogEntryId, {
            client_workstream_id: workstreamId,
            title: definition.title,
            previousPolicyClass: currentClass,
            policyClass,
            revision,
            appliesTo: "future_tasks_only",
            reason,
          });
        return { status: 200, body: {
          workstreamId, entryId: taskCatalogEntryId, policyClass, revision, changed: true,
        } };
      }),
    );
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "WORKSTREAM_NOT_FOUND" || result === "TASK_CATALOG_ENTRY_NOT_FOUND") {
      return json({ error: result }, 404);
    }
    if (result === "TASK_CATALOG_ENTRY_ARCHIVED" ||
        result === "TASK_BILLING_RULE_VERSION_CONFLICT" ||
        result === "TASK_BILLING_POLICY_NOT_CONFIGURED") return json({ error: result }, 409);
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return json({ error: "TASK_BILLING_RULE_VERSION_CONFLICT" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createOrganisationWorkstream(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const name = text(input.name);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  if (!name) return json({ error: "WORKSTREAM_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "workstreams.create.organisation", requestKey, input, async () => {
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "workstreams.create")) return "PERMISSION_DENIED" as const;
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
           VALUES ($1, $2, $3) RETURNING id`,
          [actor.context.organisationId, name, actor.context.userId],
        );
        const workstreamId = created.rows[0]?.id;
        if (!workstreamId) throw new Error("WORKSTREAM_CREATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId, "workstreams.create", "organisation_workstream", workstreamId, { name });
        return { workstreamId };
      });
    });
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    const denied = permissionDenied(result); if (denied) return denied;
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "WORKSTREAM_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createWorkGroup(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  const clientWorkstreamId = id(input.clientWorkstreamId);
  const organisationWorkstreamId = id(input.organisationWorkstreamId);
  const name = text(input.name);
  if (!name || Boolean(clientWorkstreamId) === Boolean(organisationWorkstreamId)) return json({ error: "GROUP_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const target = {
        ...(clientWorkstreamId ? { clientWorkstreamId } : {}),
      };
      return idempotent(transaction, actor.context, "groups.create", requestKey, input, async () => {
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "groups.create", target)) return "PERMISSION_DENIED" as const;
        const activeParent = clientWorkstreamId
          ? await transaction.query<{ id: string }>(
            `SELECT workstreams.id
             FROM nova.client_workstreams workstreams
             JOIN nova.clients clients
               ON clients.id = workstreams.client_id
              AND clients.organisation_id = workstreams.organisation_id
             WHERE workstreams.id = $1 AND workstreams.organisation_id = $2
               AND workstreams.archived_at IS NULL AND clients.archived_at IS NULL
             FOR SHARE OF workstreams, clients`,
            [clientWorkstreamId, actor.context.organisationId],
          )
          : await transaction.query<{ id: string }>(
            `SELECT id FROM nova.organisation_workstreams
             WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL
             FOR SHARE`,
            [organisationWorkstreamId, actor.context.organisationId],
          );
        if (!activeParent.rows[0]) return "WORKSTREAM_NOT_FOUND" as const;
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.work_groups (organisation_id, client_workstream_id, organisation_workstream_id, name, created_by_person_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [actor.context.organisationId, clientWorkstreamId ?? null, organisationWorkstreamId ?? null, name, actor.context.userId],
        );
        const groupId = created.rows[0]?.id;
        if (!groupId) throw new Error("GROUP_CREATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId, "groups.create", "work_group", groupId, { name });
        return { groupId };
      });
    });
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "WORKSTREAM_NOT_FOUND") return json({ error: result }, 404);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "GROUP_ALREADY_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createTask(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  if (Object.hasOwn(input, "billingClass") || Object.hasOwn(input, "billing_class")) {
    return json({ error: "TASK_BILLING_CLASS_SERVER_ASSIGNED" }, 400);
  }
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  const title = text(input.title, 320);
  const taskCatalogEntryId = input.taskCatalogEntryId === undefined || input.taskCatalogEntryId === null || input.taskCatalogEntryId === ""
    ? undefined : id(input.taskCatalogEntryId);
  const taskCatalogRevision = input.taskCatalogRevision === undefined
    ? undefined
    : typeof input.taskCatalogRevision === "number" && Number.isSafeInteger(input.taskCatalogRevision) && input.taskCatalogRevision > 0
      ? input.taskCatalogRevision : null;
  const clientWorkstreamId = id(input.clientWorkstreamId);
  const organisationWorkstreamId = id(input.organisationWorkstreamId);
  const workGroupId = input.workGroupId === undefined || input.workGroupId === null ? undefined : id(input.workGroupId);
  const departmentId = input.organisationDepartmentId === undefined || input.organisationDepartmentId === null ? undefined : id(input.organisationDepartmentId);
  const description = input.description === undefined ? undefined : input.description === null ? null : text(input.description, 10000);
  const priority = input.priority;
  const dueDate = input.dueDate === undefined || input.dueDate === null ? null : text(input.dueDate, 10);
  const assignToSelf = input.assignToSelf === undefined ? false : input.assignToSelf;
  const correction = taskCorrectionInput(input);
  if ((!title && input.title !== undefined) || (!title && !taskCatalogEntryId) ||
    (input.taskCatalogEntryId !== undefined && input.taskCatalogEntryId !== null && input.taskCatalogEntryId !== "" && !taskCatalogEntryId) ||
    (taskCatalogEntryId && !taskCatalogRevision) || (!taskCatalogEntryId && taskCatalogRevision !== undefined) ||
    Boolean(clientWorkstreamId) === Boolean(organisationWorkstreamId) ||
    (input.workGroupId !== undefined && input.workGroupId !== null && !workGroupId) ||
    (input.organisationDepartmentId !== undefined && input.organisationDepartmentId !== null && !departmentId) ||
    (input.description !== undefined && description === undefined) ||
    (priority !== undefined && !["low", "normal", "high", "urgent"].includes(String(priority))) ||
    (dueDate !== null && !validTaskDueDate(dueDate)) || typeof assignToSelf !== "boolean" || !correction) return json({ error: "TASK_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "tasks.create", requestKey, input, async () => {
        let clientId: string | undefined;
        let billingPolicyMissing = false;
        let taskBillingClass: TaskBillingClass = "non_billable";
        let billingPolicySource: "client_workstream" | "client_workstream_task_definition" | "organisation_default" = "organisation_default";
        let billingPolicyRevision = 1;
        if (clientWorkstreamId) {
          const context = await transaction.query<{
            client_id: string; billing_policy_class: TaskBillingClass | null; billing_policy_revision: number;
          }>(
            `SELECT workstreams.client_id, workstreams.billing_policy_class, workstreams.billing_policy_revision
             FROM nova.client_workstreams workstreams
             JOIN nova.clients clients
               ON clients.id = workstreams.client_id
              AND clients.organisation_id = workstreams.organisation_id
             WHERE workstreams.id = $1 AND workstreams.organisation_id = $2
               AND workstreams.archived_at IS NULL AND clients.archived_at IS NULL
             FOR SHARE OF workstreams, clients`,
            [clientWorkstreamId, actor.context.organisationId],
          );
          if (!context.rows[0]) {
            if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId,
              "tasks.create", { clientWorkstreamId, ...(workGroupId ? { groupId: workGroupId } : {}) })) {
              return "PERMISSION_DENIED" as const;
            }
            return "TASK_CONTEXT_INVALID" as const;
          }
          clientId = context.rows[0].client_id;
          billingPolicyMissing = context.rows[0].billing_policy_class === null;
          if (!billingPolicyMissing) {
            taskBillingClass = context.rows[0].billing_policy_class!;
            billingPolicySource = "client_workstream";
            billingPolicyRevision = context.rows[0].billing_policy_revision;
          }
        } else {
          const context = await transaction.query<{ id: string }>(
            `SELECT id FROM nova.organisation_workstreams
             WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL FOR SHARE`,
            [organisationWorkstreamId, actor.context.organisationId],
          );
          if (!context.rows[0]) return "TASK_CONTEXT_INVALID" as const;
        }
        const target = {
          ...(clientId ? { clientId } : {}),
          ...(clientWorkstreamId ? { clientWorkstreamId } : {}),
          ...(workGroupId ? { groupId: workGroupId } : {}),
        };
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.create", target)) return "PERMISSION_DENIED" as const;
        if (workGroupId) {
          const group = await transaction.query<{ id: string }>(
            `SELECT id FROM nova.work_groups
             WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL
               AND (($3::uuid IS NOT NULL AND client_workstream_id = $3)
                 OR ($4::uuid IS NOT NULL AND organisation_workstream_id = $4))
             FOR SHARE`,
            [workGroupId, actor.context.organisationId, clientWorkstreamId ?? null, organisationWorkstreamId ?? null],
          );
          if (!group.rows[0]) return "TASK_CONTEXT_INVALID" as const;
        }
        if (billingPolicyMissing) return "TASK_BILLING_POLICY_NOT_CONFIGURED" as const;
        const canCreateBillable = await hasPermission(
          transaction, actor.context.userId, actor.context.organisationId, "tasks.create.billable", target,
        );
        let taskTitle = title;
        let taskDescription = description ?? null;
        let taskPriority = (priority ?? "normal") as string;
        let catalogRevision: number | null = null;
        if (taskCatalogEntryId) {
          const canViewCatalog = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.view");
          const canManageCatalog = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage");
          if (!canViewCatalog && !canManageCatalog) return "PERMISSION_DENIED" as const;
          const selectedCatalog = await transaction.query<{
            title: string; description: string | null; priority: string; revision: number; archived_at: Date | null;
          }>(
            `SELECT title, description, priority, revision, archived_at
             FROM nova.task_catalog_entries
             WHERE id = $1 AND organisation_id = $2
             FOR SHARE`,
            [taskCatalogEntryId, actor.context.organisationId],
          );
          const template = selectedCatalog.rows[0];
          if (!template) return "TASK_CATALOG_ENTRY_NOT_FOUND" as const;
          if (template.archived_at) return "TASK_CATALOG_ENTRY_ARCHIVED" as const;
          if (template.revision !== taskCatalogRevision) return "TASK_CATALOG_VERSION_CONFLICT" as const;
          taskTitle ??= template.title;
          if (description === undefined) taskDescription = template.description;
          if (priority === undefined) taskPriority = template.priority;
          catalogRevision = template.revision;
          if (clientWorkstreamId) {
            const definitionPolicy = await transaction.query<{
              billing_class: TaskBillingClass | null; revision: number;
            }>(
              `SELECT billing_class, revision
               FROM nova.client_workstream_task_billing_rules
               WHERE organisation_id = $1 AND client_workstream_id = $2 AND task_catalog_entry_id = $3
               FOR SHARE`,
              [actor.context.organisationId, clientWorkstreamId, taskCatalogEntryId],
            );
            const rule = definitionPolicy.rows[0];
            if (rule?.billing_class) {
              taskBillingClass = rule.billing_class;
              billingPolicySource = "client_workstream_task_definition";
              billingPolicyRevision = rule.revision;
            }
          }
        }
        if (!taskTitle) return "TASK_CATALOG_ENTRY_NOT_FOUND" as const;
        if (correction.correctionOfTaskId) {
          const sourceResult = await transaction.query<{
            id: string; status: string; correction_of_task_id: string | null;
            client_id: string | null; client_workstream_id: string | null;
            organisation_workstream_id: string | null; work_group_id: string | null;
          }>(
            `SELECT source.id, source.status, source.correction_of_task_id,
                    clients.id AS client_id, source.client_workstream_id,
                    source.organisation_workstream_id, source.work_group_id
             FROM nova.tasks source
             LEFT JOIN nova.client_workstreams workstreams
               ON workstreams.id = source.client_workstream_id
             LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
             WHERE source.id = $1 AND source.organisation_id = $2
             FOR UPDATE OF source`,
            [correction.correctionOfTaskId, actor.context.organisationId],
          );
          const source = sourceResult.rows[0];
          if (!source) return "TASK_CORRECTION_SOURCE_NOT_FOUND" as const;
          if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.view", {
            ...(source.client_id ? { clientId: source.client_id } : {}),
            ...(source.client_workstream_id ? { clientWorkstreamId: source.client_workstream_id } : {}),
            ...(source.work_group_id ? { groupId: source.work_group_id } : {}),
            taskId: source.id,
          })) return "TASK_CORRECTION_SOURCE_NOT_FOUND" as const;
          if (source.status !== "approved" && source.status !== "done") return "TASK_CORRECTION_SOURCE_NOT_COMPLETE" as const;
          if (source.correction_of_task_id) return "TASK_CORRECTION_NESTING_NOT_ALLOWED" as const;
          if (source.client_workstream_id !== (clientWorkstreamId ?? null) ||
              source.organisation_workstream_id !== (organisationWorkstreamId ?? null)) {
            return "TASK_CORRECTION_WORKSTREAM_MISMATCH" as const;
          }
        }
        if (taskBillingClass === "billable" && !canCreateBillable) return "PERMISSION_DENIED" as const;
        if (assignToSelf && !await personCanReceiveAssignments(transaction, actor.context.userId, actor.context.organisationId)) {
          return "PERSON_NOT_ASSIGNABLE" as const;
        }
        const created = await transaction.query<{
          id: string; billing_class: TaskBillingClass; billing_policy_source: string; billing_policy_revision: number;
        }>(
          `INSERT INTO nova.tasks (
            organisation_id, client_workstream_id, organisation_workstream_id, work_group_id,
            organisation_department_id, title, description, priority, due_date, created_by_person_id,
            correction_of_task_id, correction_reason, task_catalog_entry_id, task_catalog_revision
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, $14)
          RETURNING id, billing_class, billing_policy_source, billing_policy_revision`,
          [actor.context.organisationId, clientWorkstreamId ?? null, organisationWorkstreamId ?? null,
            workGroupId ?? null, departmentId ?? null, taskTitle, taskDescription, taskPriority, dueDate,
            actor.context.userId, correction.correctionOfTaskId, correction.correctionReason,
            taskCatalogEntryId ?? null, catalogRevision],
        );
        const storedTask = created.rows[0];
        if (!storedTask?.id || !storedTask.billing_class || !storedTask.billing_policy_source) throw new Error("TASK_CREATE_RESULT_MISSING");
        if (storedTask.billing_class !== taskBillingClass ||
            storedTask.billing_policy_source !== billingPolicySource ||
            storedTask.billing_policy_revision !== billingPolicyRevision) {
          throw new Error("TASK_BILLING_POLICY_SNAPSHOT_MISMATCH");
        }
        const taskId = storedTask.id;
        await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.create", "task", taskId, {
          title: taskTitle,
          priority: taskPriority,
          billing_class: storedTask.billing_class,
          billing_policy_source: storedTask.billing_policy_source,
          billing_policy_revision: storedTask.billing_policy_revision,
          correction_of_task_id: correction.correctionOfTaskId,
          task_catalog_entry_id: taskCatalogEntryId ?? null,
          task_catalog_revision: catalogRevision,
        });
        let assignmentId: string | null = null;
        if (assignToSelf) {
          const assignment = await transaction.query<{ id: string }>(
            `INSERT INTO nova.task_assignments (
               organisation_id, task_id, person_id, reviewer_person_id,
               review_required, assigned_by_person_id
             ) VALUES ($1, $2, $3, NULL, $4, $3)
             RETURNING id`,
            [actor.context.organisationId, taskId, actor.context.userId, Boolean(clientWorkstreamId)],
          );
          assignmentId = assignment.rows[0]?.id ?? null;
          if (!assignmentId) throw new Error("SELF_ASSIGNMENT_CREATE_RESULT_MISSING");
          await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.assign_self", "task_assignment", assignmentId, { task_id: taskId });
        }
        return {
          taskId, assignmentId, billingClass: storedTask.billing_class,
          billingPolicySource: storedTask.billing_policy_source,
          billingPolicyRevision: storedTask.billing_policy_revision,
        };
      });
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "TASK_CONTEXT_INVALID") return json({ error: result }, 409);
    if (result === "TASK_BILLING_POLICY_NOT_CONFIGURED") return json({ error: result }, 409);
    if (result === "PERSON_NOT_ASSIGNABLE") return json({ error: result }, 409);
    if (result === "TASK_CATALOG_ENTRY_NOT_FOUND") return json({ error: result }, 404);
    if (result === "TASK_CATALOG_ENTRY_ARCHIVED" || result === "TASK_CATALOG_VERSION_CONFLICT") return json({ error: result }, 409);
    if (result === "TASK_CORRECTION_SOURCE_NOT_FOUND") return json({ error: result }, 404);
    if (typeof result === "string" && result.startsWith("TASK_CORRECTION_")) return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("TASK_BILLING_POLICY_NOT_CONFIGURED")) return json({ error: "TASK_BILLING_POLICY_NOT_CONFIGURED" }, 409);
    if (error instanceof Error && error.message.includes("TASK_CORRECTION_SOURCE_NOT_FOUND")) return json({ error: "TASK_CORRECTION_SOURCE_NOT_FOUND" }, 404);
    if (error instanceof Error && error.message.startsWith("TASK_CORRECTION_")) return json({ error: error.message.split("\n", 1)[0] }, 409);
    if (error instanceof Error && /TASK_GROUP_CONTEXT|WORK_CONTEXT|invalid input syntax/i.test(error.message)) return json({ error: "TASK_CONTEXT_INVALID" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createTaskAssignment(request: Request, taskId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(taskId)) return json({ error: "TASK_NOT_FOUND" }, 404);
  const input = await body(request);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  const personId = id(input.personId);
  const reviewerPersonId = input.reviewerPersonId === undefined || input.reviewerPersonId === null ? null : id(input.reviewerPersonId);
  const reviewRequiredInput = input.reviewRequired === undefined ? undefined : input.reviewRequired;
  if (!personId || (reviewerPersonId === undefined) || (reviewRequiredInput !== undefined && typeof reviewRequiredInput !== "boolean") || reviewerPersonId === personId) {
    return json({ error: "ASSIGNMENT_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return idempotent(transaction, actor.context, "tasks.assign", requestKey, { taskId, ...input }, async () => {
        const task = await transaction.query<{ id: string; client_id: string | null; client_workstream_id: string | null; organisation_workstream_id: string | null; work_group_id: string | null }>(
          `SELECT tasks.id, clients.id AS client_id, tasks.client_workstream_id,
                  tasks.organisation_workstream_id, tasks.work_group_id
           FROM nova.tasks
           LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
           LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
          WHERE tasks.id = $1 AND tasks.organisation_id = $2 AND tasks.status <> 'cancelled'
          FOR UPDATE OF tasks`,
          [taskId, actor.context.organisationId],
        );
        const row = task.rows[0];
        if (!row) return "TASK_NOT_FOUND" as const;
        const target = {
          ...(row.client_id ? { clientId: row.client_id } : {}),
          ...(row.client_workstream_id ? { clientWorkstreamId: row.client_workstream_id } : {}),
          ...(row.work_group_id ? { groupId: row.work_group_id } : {}),
        };
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.assign", { ...target, taskId })) return "PERMISSION_DENIED" as const;
        if (!await personCanReceiveAssignments(transaction, personId, actor.context.organisationId)) return "PERSON_NOT_ASSIGNABLE" as const;
        const reviewRequired = reviewRequiredInput === undefined ? Boolean(row.client_workstream_id) : reviewRequiredInput;
        if (row.client_workstream_id && reviewRequiredInput === false) return "REVIEW_POLICY_REQUIRES_REVIEW" as const;
        const effectiveReviewRequired = reviewerPersonId ? true : reviewRequired;
        if (reviewerPersonId && !await personCanReviewTarget(transaction, reviewerPersonId, actor.context.organisationId, { ...target, taskId })) return "REVIEWER_NOT_ASSIGNABLE" as const;
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.task_assignments (
            organisation_id, task_id, person_id, reviewer_person_id, review_required, assigned_by_person_id
          ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [actor.context.organisationId, taskId, personId, reviewerPersonId, effectiveReviewRequired, actor.context.userId],
        );
        const assignmentId = created.rows[0]?.id;
        if (!assignmentId) throw new Error("ASSIGNMENT_CREATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.assign", "task_assignment", assignmentId, { task_id: taskId, person_id: personId, reviewer_person_id: reviewerPersonId });
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: personId,
          eventKey: "task.assigned",
          title: "Task assigned",
          body: "A new task has been assigned to you.",
          aggregateType: "task_assignment",
          aggregateId: assignmentId,
          deepLink: "/?view=work&task=" + taskId,
          idempotencyKey: "task.assigned:" + assignmentId,
        });
        if (reviewerPersonId) {
          await enqueueNotification(transaction, {
            organisationId: actor.context.organisationId,
            recipientPersonId: reviewerPersonId,
            eventKey: "task.review_requested",
            title: "Review requested",
            body: "You have been selected to review an assigned task.",
            aggregateType: "task_assignment",
            aggregateId: assignmentId,
            deepLink: "/?view=work&review=" + assignmentId,
            idempotencyKey: "task.review_requested:" + assignmentId + ":" + reviewerPersonId,
          });
        }
        return { assignmentId };
      });
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "TASK_NOT_FOUND") return json({ error: result }, 404);
    if (result === "PERSON_NOT_ASSIGNABLE" || result === "REVIEWER_NOT_ASSIGNABLE" || result === "REVIEW_POLICY_REQUIRES_REVIEW") return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "PERSON_ALREADY_ASSIGNED" }, 409);
    if (error instanceof Error && /WORK_CONTEXT_PERSON|violates check constraint/i.test(error.message)) return json({ error: "ASSIGNMENT_INPUT_INVALID" }, 400);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateAssignmentReviewer(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  const reviewerPersonId = id((await body(request)).reviewerPersonId);
  if (!reviewerPersonId) return json({ error: "ASSIGNMENT_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const row = await transaction.query<{ id: string; task_id: string; person_id: string; status: string; client_id: string | null; client_workstream_id: string | null; work_group_id: string | null }>(
        `SELECT assignments.id, assignments.task_id, assignments.person_id,
                assignments.status,
                clients.id AS client_id, tasks.client_workstream_id, tasks.work_group_id
         FROM nova.task_assignments assignments
         JOIN nova.tasks tasks ON tasks.id = assignments.task_id
         LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
         LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
         WHERE assignments.id = $1 AND assignments.organisation_id = $2
         FOR UPDATE`,
        [assignmentId, actor.context.organisationId],
      );
      const assignment = row.rows[0];
      if (!assignment) return "ASSIGNMENT_NOT_FOUND" as const;
      if (["approved", "cancelled"].includes(assignment.status)) return "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE" as const;
      if (assignment.person_id === reviewerPersonId) return "SELF_REVIEW_NOT_ALLOWED" as const;
      const target = {
        ...(assignment.client_id ? { clientId: assignment.client_id } : {}),
        ...(assignment.client_workstream_id ? { clientWorkstreamId: assignment.client_workstream_id } : {}),
        ...(assignment.work_group_id ? { groupId: assignment.work_group_id } : {}),
      };
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId,
        "tasks.reviewer_manage", exactReviewerManagementTarget(assignment.id, assignment.task_id, target))) {
        return "PERMISSION_DENIED" as const;
      }
      if (!await personCanReviewTarget(transaction, reviewerPersonId, actor.context.organisationId, { ...target, taskId: assignment.task_id })) return "REVIEWER_NOT_ASSIGNABLE" as const;
      const updated = await transaction.query<{ id: string }>(
        `UPDATE nova.task_assignments
         SET reviewer_person_id = $2,
             review_required = true,
             reviewer_exception_reason = NULL,
             reviewer_exception_granted_by_person_id = NULL,
             reviewer_exception_granted_at = NULL,
             review_blocked_reason = NULL,
             review_blocked_at = NULL
         WHERE id = $1 RETURNING id`,
        [assignmentId, reviewerPersonId],
      );
      if (!updated.rows[0]) throw new Error("ASSIGNMENT_UPDATE_RESULT_MISSING");
      await transaction.query(
        `UPDATE nova.task_review_cycles
         SET reviewer_person_id = $2
         WHERE assignment_id = $1 AND decided_at IS NULL`,
        [assignmentId, reviewerPersonId],
      );
      await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.reviewer_changed", "task_assignment", assignmentId, { reviewer_person_id: reviewerPersonId });
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId,
        recipientPersonId: reviewerPersonId,
        eventKey: "task.review_requested",
        title: "Review requested",
        body: "You have been selected to review an assigned task.",
        aggregateType: "task_assignment",
        aggregateId: assignmentId,
        deepLink: "/?view=work&review=" + assignmentId,
        idempotencyKey: "task.review_requested:" + assignmentId + ":" + reviewerPersonId,
      });
      return assignmentId;
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (result === "SELF_REVIEW_NOT_ALLOWED" || result === "REVIEWER_NOT_ASSIGNABLE" || result === "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE") return json({ error: result }, 409);
    return json({ assignmentId: result });
  } catch (error) {
    if (error instanceof Error && /WORK_CONTEXT_PERSON|foreign key/i.test(error.message)) return json({ error: "ASSIGNMENT_INPUT_INVALID" }, 400);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function grantReviewerException(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  const input = await body(request);
  const reviewerPersonId = id(input.reviewerPersonId);
  const reason = text(input.reason, 2000);
  if (!reviewerPersonId || !reason) return json({ error: "REVIEWER_EXCEPTION_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const owner = await transaction.query<{ permitted: boolean }>("SELECT nova.request_actor_is_super_admin() AS permitted");
      if (owner.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      const rowResult = await transaction.query<{
        id: string; task_id: string; person_id: string; status: string; title: string; review_required: boolean;
      }>(
        reviewerExceptionGrantTargetSql,
        [assignmentId, actor.context.organisationId],
      );
      const row = rowResult.rows[0];
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (!reviewerExceptionTargetEligible(row.status, row.review_required)) return "ASSIGNMENT_NOT_EXCEPTION_ELIGIBLE" as const;
      if (reviewerPersonId === row.person_id) return "SELF_REVIEW_NOT_ALLOWED" as const;
      const reviewer = await transaction.query<{ id: string }>(
        `SELECT people.id
         FROM nova.people
         JOIN nova.person_status_periods status ON status.person_id = people.id AND status.ended_at IS NULL
         WHERE people.id = $1 AND people.organisation_id = $2 AND status.status IN ('active', 'notice')`,
        [reviewerPersonId, actor.context.organisationId],
      );
      if (!reviewer.rows[0]) return "REVIEWER_NOT_ASSIGNABLE" as const;
      await transaction.query(
        `UPDATE nova.task_assignments
         SET reviewer_person_id = $2,
             reviewer_exception_reason = $3,
             reviewer_exception_granted_by_person_id = $4,
             reviewer_exception_granted_at = clock_timestamp(),
             review_blocked_reason = NULL,
             review_blocked_at = NULL
         WHERE id = $1`,
        [assignmentId, reviewerPersonId, reason, actor.context.userId],
      );
      await transaction.query(
        `UPDATE nova.task_review_cycles
         SET reviewer_person_id = $2
         WHERE assignment_id = $1 AND decided_at IS NULL`,
        [assignmentId, reviewerPersonId],
      );
      await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.reviewer_exception_granted", "task_assignment", assignmentId, {
        reviewer_person_id: reviewerPersonId, reason,
      });
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId, recipientPersonId: reviewerPersonId,
        eventKey: "task.review_requested", title: "Review requested", body: `You have been selected to review: ${row.title}.`,
        aggregateType: "task_assignment", aggregateId: assignmentId, deepLink: "/?view=work&review=" + assignmentId,
        idempotencyKey: `task.review_exception:${assignmentId}:${reviewerPersonId}`,
      });
      return { assignmentId, reviewerPersonId, exception: true };
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (["ASSIGNMENT_NOT_EXCEPTION_ELIGIBLE", "SELF_REVIEW_NOT_ALLOWED", "REVIEWER_NOT_ASSIGNABLE"].includes(result as string)) return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function cancelTask(request: Request, taskId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(taskId)) return json({ error: "TASK_NOT_FOUND" }, 404);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const taskResult = await transaction.query<{
        id: string; client_id: string | null; client_workstream_id: string | null; work_group_id: string | null; status: string; title: string;
      }>(
        `SELECT tasks.id, clients.id AS client_id, tasks.client_workstream_id,
                tasks.work_group_id, tasks.status, tasks.title
         FROM nova.tasks tasks
         LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
         LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
         WHERE tasks.id = $1 AND tasks.organisation_id = $2
         FOR UPDATE OF tasks`,
        [taskId, actor.context.organisationId],
      );
      const task = taskResult.rows[0];
      if (!task) return "TASK_NOT_FOUND" as const;
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.edit", {
        clientId: task.client_id ?? undefined, clientWorkstreamId: task.client_workstream_id ?? undefined,
        groupId: task.work_group_id ?? undefined, taskId,
      })) return "PERMISSION_DENIED" as const;
      if (["cancelled", "approved", "done"].includes(task.status)) return "TASK_NOT_CANCELLABLE" as const;
      const assignments = await transaction.query<{ id: string; person_id: string; status: string }>(
        `SELECT id, person_id, status FROM nova.task_assignments WHERE task_id = $1 FOR UPDATE`, [taskId],
      );
      const cancelled: string[] = [];
      let closedSessionCount = 0;
      for (const assignment of assignments.rows) {
        const closed = await transaction.query<{ count: number }>(
          `SELECT nova.close_assignment_work_sessions($1, clock_timestamp(), 'TASK_CANCELLED') AS count`,
          [assignment.id],
        );
        closedSessionCount += Number(closed.rows[0]?.count ?? 0);
        if (!["approved", "cancelled"].includes(assignment.status)) {
          await transaction.query(
            `UPDATE nova.task_assignments SET status = 'cancelled' WHERE id = $1`, [assignment.id],
          );
          await enqueueNotification(transaction, {
            organisationId: actor.context.organisationId, recipientPersonId: assignment.person_id,
            eventKey: "task.cancelled", title: "Task cancelled", body: `The task was cancelled: ${task.title}.`,
            aggregateType: "task", aggregateId: taskId, deepLink: "/?view=work&task=" + taskId,
            idempotencyKey: `task.cancelled:${taskId}:${assignment.id}`,
          });
          cancelled.push(assignment.id);
        }
      }
      await transaction.query(`UPDATE nova.tasks SET status = 'cancelled' WHERE id = $1`, [taskId]);
      await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.cancelled", "task", taskId, { cancelled_assignment_ids: cancelled, closed_session_count: closedSessionCount });
      return { taskId, status: "cancelled", cancelledAssignmentCount: cancelled.length, closedSessionCount };
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "TASK_NOT_FOUND") return json({ error: result }, 404);
    if (result === "TASK_NOT_CANCELLABLE") return json({ error: result }, 409);
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function updateTaskDueDate(request: Request, taskId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(taskId)) return json({ error: "TASK_NOT_FOUND" }, 404);
  const input = await body(request);
  const nullableDate = (value: unknown): string | null | undefined => {
    if (value === null || value === "") return null;
    return validTaskDueDate(value) ? value : undefined;
  };
  const dueDate = Object.hasOwn(input, "dueDate") ? nullableDate(input.dueDate) : undefined;
  const expectedDueDate = Object.hasOwn(input, "expectedDueDate")
    ? nullableDate(input.expectedDueDate)
    : undefined;
  const expectedDueDateRevision = input.expectedDueDateRevision;
  if (dueDate === undefined || expectedDueDate === undefined ||
    typeof expectedDueDateRevision !== "number" ||
    !Number.isSafeInteger(expectedDueDateRevision) || expectedDueDateRevision < 0) {
    return json({ error: "TASK_DUE_DATE_INPUT_INVALID" }, 400);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const selected = await transaction.query<{
        id: string; title: string; status: string; due_date: string | null;
        due_date_revision: number; client_id: string | null;
        client_workstream_id: string | null; work_group_id: string | null;
      }>(
        `SELECT tasks.id, tasks.title, tasks.status, tasks.due_date::text,
                tasks.due_date_revision, clients.id AS client_id,
                tasks.client_workstream_id, tasks.work_group_id
         FROM nova.tasks tasks
         LEFT JOIN nova.client_workstreams workstreams
           ON workstreams.id = tasks.client_workstream_id
         LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
         WHERE tasks.id = $1 AND tasks.organisation_id = $2
         FOR UPDATE OF tasks`,
        [taskId, actor.context.organisationId],
      );
      const task = selected.rows[0];
      if (!task) return "TASK_NOT_FOUND" as const;
      const target = {
        ...(task.client_id ? { clientId: task.client_id } : {}),
        ...(task.client_workstream_id ? { clientWorkstreamId: task.client_workstream_id } : {}),
        ...(task.work_group_id ? { groupId: task.work_group_id } : {}),
        taskId,
      };
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.edit", target)) {
        return "PERMISSION_DENIED" as const;
      }
      if (["approved", "done", "cancelled"].includes(task.status)) {
        return "TASK_DUE_DATE_NOT_EDITABLE" as const;
      }
      if (task.due_date !== expectedDueDate || task.due_date_revision !== expectedDueDateRevision) {
        return "TASK_DUE_DATE_CONFLICT" as const;
      }
      if (task.due_date === dueDate) {
        return { taskId, dueDate, dueDateRevision: task.due_date_revision, changed: false, notifiedAssigneeCount: 0 };
      }

      const changed = await transaction.query<{ due_date_revision: number }>(
        `UPDATE nova.tasks SET due_date = $2::date
         WHERE id = $1 AND organisation_id = $3
         RETURNING due_date_revision`,
        [taskId, dueDate, actor.context.organisationId],
      );
      const dueDateRevision = changed.rows[0]?.due_date_revision;
      if (dueDateRevision === undefined) throw new Error("TASK_DUE_DATE_UPDATE_RESULT_MISSING");

      const invalidated = await transaction.query<{ count: number }>(
        `SELECT nova.expire_task_due_notifications($1) AS count`, [taskId],
      );
      const assignments = await transaction.query<{ id: string; person_id: string }>(
        `SELECT id, person_id FROM nova.task_assignments
         WHERE task_id = $1 AND organisation_id = $2
           AND status NOT IN ('approved', 'cancelled')
         ORDER BY id`,
        [taskId, actor.context.organisationId],
      );
      for (const assignment of assignments.rows) {
        const dateDescription = dueDate
          ? `The due date changed from ${task.due_date ?? "none"} to ${dueDate} for: ${task.title}.`
          : `The due date was removed for: ${task.title}.`;
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: assignment.person_id,
          eventKey: "task.due_date_changed",
          title: "Task due date changed",
          body: dateDescription,
          aggregateType: "task_assignment",
          aggregateId: assignment.id,
          deepLink: "/?view=work&task=" + taskId,
          idempotencyKey: `task.due_date_changed:${assignment.id}:${dueDateRevision}`,
        });
      }
      await audit(transaction, actor.context.organisationId, actor.context.userId,
        "tasks.due_date_changed", "task", taskId, {
          previous_due_date: task.due_date,
          due_date: dueDate,
          due_date_revision: dueDateRevision,
          expired_due_notification_count: Number(invalidated.rows[0]?.count ?? 0),
          notified_assignee_count: assignments.rows.length,
        });
      return {
        taskId, dueDate, dueDateRevision, changed: true,
        expiredDueNotificationCount: Number(invalidated.rows[0]?.count ?? 0),
        notifiedAssigneeCount: assignments.rows.length,
      };
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "TASK_NOT_FOUND") return json({ error: result }, 404);
    if (result === "TASK_DUE_DATE_NOT_EDITABLE" || result === "TASK_DUE_DATE_CONFLICT") {
      return json({ error: result }, 409);
    }
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function reassignTaskAssignment(request: Request, assignmentId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(assignmentId)) return json({ error: "ASSIGNMENT_NOT_FOUND" }, 404);
  const input = await body(request);
  const personId = id(input.personId);
  const reviewerInput = input.reviewerPersonId === undefined ? undefined : (input.reviewerPersonId === null ? null : id(input.reviewerPersonId));
  const reviewRequiredInput = input.reviewRequired === undefined ? undefined : input.reviewRequired;
  if (!personId || reviewerInput === undefined && input.reviewerPersonId !== undefined || typeof reviewRequiredInput !== "undefined" && typeof reviewRequiredInput !== "boolean") {
    return json({ error: "REASSIGNMENT_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rowResult = await transaction.query<{
        id: string; task_id: string; old_person_id: string; reviewer_person_id: string | null; review_required: boolean;
        status: string; task_status: string; client_id: string | null; client_workstream_id: string | null; work_group_id: string | null; title: string;
      }>(
        `SELECT assignments.id, assignments.task_id, assignments.person_id AS old_person_id,
                assignments.reviewer_person_id, assignments.review_required, assignments.status,
                tasks.status AS task_status, clients.id AS client_id, tasks.client_workstream_id,
                tasks.work_group_id, tasks.title
         FROM nova.task_assignments assignments
         JOIN nova.tasks tasks ON tasks.id = assignments.task_id
         LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
         LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
         WHERE assignments.id = $1 AND assignments.organisation_id = $2
         FOR UPDATE OF assignments, tasks`,
        [assignmentId, actor.context.organisationId],
      );
      const row = rowResult.rows[0];
      if (!row) return "ASSIGNMENT_NOT_FOUND" as const;
      if (row.task_status === "cancelled" || row.status === "cancelled") return "ASSIGNMENT_NOT_REASSIGNABLE" as const;
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.reassign", {
        clientId: row.client_id ?? undefined, clientWorkstreamId: row.client_workstream_id ?? undefined,
        groupId: row.work_group_id ?? undefined, taskId: row.task_id,
      })) return "PERMISSION_DENIED" as const;
      if (personId === row.old_person_id) return "PERSON_ALREADY_ASSIGNED" as const;
      if (!await personCanReceiveAssignments(transaction, personId, actor.context.organisationId)) return "PERSON_NOT_ASSIGNABLE" as const;
      const isClientWork = Boolean(row.client_workstream_id);
      if (isClientWork && reviewRequiredInput === false) return "REVIEW_POLICY_REQUIRES_REVIEW" as const;
      const reviewRequired = reviewRequiredInput ?? (isClientWork ? true : row.review_required);
      const reviewerPersonId = reviewerInput === undefined ? row.reviewer_person_id : reviewerInput;
      const effectiveReviewRequired = reviewerPersonId ? true : reviewRequired;
      if (effectiveReviewRequired && !reviewerPersonId) return "REVIEWER_REQUIRED" as const;
      if (reviewerPersonId === personId) return "SELF_REVIEW_NOT_ALLOWED" as const;
      if (reviewerPersonId) {
        if (!await personCanReviewTarget(transaction, reviewerPersonId, actor.context.organisationId, {
          clientId: row.client_id ?? undefined,
          clientWorkstreamId: row.client_workstream_id ?? undefined,
          groupId: row.work_group_id ?? undefined,
          taskId: row.task_id,
        })) return "REVIEWER_NOT_ASSIGNABLE" as const;
      }
      if (row.status !== "approved") {
        await transaction.query(`UPDATE nova.task_assignments SET status = 'cancelled' WHERE id = $1`, [assignmentId]);
      }
      await transaction.query(
        `SELECT nova.close_assignment_work_sessions($1, clock_timestamp(), 'ASSIGNMENT_REASSIGNED') AS count`,
        [assignmentId],
      );
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.task_assignments (
           organisation_id, task_id, person_id, reviewer_person_id,
           review_required, assigned_by_person_id
         ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [actor.context.organisationId, row.task_id, personId, reviewerPersonId, effectiveReviewRequired, actor.context.userId],
      );
      const newAssignmentId = created.rows[0]?.id;
      if (!newAssignmentId) throw new Error("REASSIGNMENT_CREATE_RESULT_MISSING");
      await transaction.query(
        `UPDATE nova.tasks SET status = 'in_progress' WHERE id = $1 AND status NOT IN ('cancelled', 'done')`, [row.task_id],
      );
      await audit(transaction, actor.context.organisationId, actor.context.userId, "tasks.reassigned", "task_assignment", newAssignmentId, {
        previous_assignment_id: assignmentId, previous_person_id: row.old_person_id, person_id: personId,
      });
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId, recipientPersonId: row.old_person_id,
        eventKey: "task.reassigned", title: "Task reassigned away",
        body: `The task was reassigned to another person: ${row.title}.`,
        aggregateType: "task_assignment", aggregateId: newAssignmentId,
        deepLink: "/?view=work&task=" + row.task_id,
        idempotencyKey: `task.reassigned:previous:${assignmentId}:${newAssignmentId}`,
      });
      await enqueueNotification(transaction, {
        organisationId: actor.context.organisationId, recipientPersonId: personId,
        eventKey: "task.reassigned", title: "Task reassigned", body: `A task has been assigned to you: ${row.title}.`,
        aggregateType: "task_assignment", aggregateId: newAssignmentId, deepLink: "/?view=work&task=" + row.task_id,
        idempotencyKey: `task.reassigned:${newAssignmentId}`,
      });
      return { assignmentId: newAssignmentId, previousAssignmentId: assignmentId };
    });
    const denied = permissionDenied(result); if (denied) return denied;
    if (result === "ASSIGNMENT_NOT_FOUND") return json({ error: result }, 404);
    if (["ASSIGNMENT_NOT_REASSIGNABLE", "PERSON_ALREADY_ASSIGNED", "PERSON_NOT_ASSIGNABLE", "REVIEWER_REQUIRED", "SELF_REVIEW_NOT_ALLOWED", "REVIEWER_NOT_ASSIGNABLE", "REVIEW_POLICY_REQUIRES_REVIEW"].includes(result as string)) return json({ error: result }, 409);
    return json(result, 201);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "PERSON_ALREADY_ASSIGNED" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readWorkContext(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const searchTerms = searchParams.getAll("q");
  const search = (searchTerms[0] || "").trim();
  if (searchTerms.length > 1 || search.length > 120) {
    return json({ error: "WORK_CONTEXT_SEARCH_INPUT_INVALID" }, 400);
  }
  const searchPattern = workContextSearchPattern(search);
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const canReceiveAssignments = await personCanReceiveAssignments(
        transaction, actor.context.userId, actor.context.organisationId,
      );
      const clientViewGrant = `(
        ${workContextPermissionSql("clients.view", { clientId: "clients.id" })}
        OR ${workContextPermissionSql("workstreams.view", { clientId: "clients.id" })}
        OR ${workContextPermissionSql("clients.members.manage", { clientId: "clients.id" })}
      )`;
      const clientWorkstreamCreateGrant = workContextPermissionSql("workstreams.create", {
        clientId: "clients.id", allowedScopes: ["client"],
      });
      const clientVisibilityGrant = `(${clientViewGrant} OR ${clientWorkstreamCreateGrant})`;
      const clientWorkstreamViewGrant = (alias: string) => workContextPermissionSql("workstreams.view", {
        clientId: `${alias}.client_id`, clientWorkstreamId: `${alias}.id`,
      });
      const clientWorkstreamBillingGrant = (alias: string) => workContextPermissionSql("workstreams.billing_policy.manage", {
        clientId: `${alias}.client_id`, clientWorkstreamId: `${alias}.id`,
      });
      const clientWorkstreamGroupGrant = (alias: string) => workContextPermissionSql("groups.create", {
          clientId: `${alias}.client_id`, clientWorkstreamId: `${alias}.id`,
          allowedScopes: ["organisation", "client_workstream"],
      });
      const clientWorkstreamVisibilityGrant = (alias: string) => `(
        ${clientWorkstreamViewGrant(alias)} OR ${clientWorkstreamBillingGrant(alias)} OR ${clientWorkstreamGroupGrant(alias)}
      )`;
      const clientWorkstreamTaskGrant = (alias: string) => workContextPermissionSql("tasks.create", {
        clientId: `${alias}.client_id`, clientWorkstreamId: `${alias}.id`,
      });
      const organisationWorkstreamViewGrant = workContextPermissionSql("workstreams.view", {});
      const organisationWorkstreamGroupGrant = workContextPermissionSql("groups.create", { allowedScopes: ["organisation"] });
      const organisationWorkstreamVisibilityGrant = `(${organisationWorkstreamViewGrant} OR ${organisationWorkstreamGroupGrant})`;
      const organisationTaskGrant = workContextPermissionSql("tasks.create", {});
      const clientWorkstreamGroupViewGrant = workContextPermissionSql("groups.view", {
        clientId: "matched_stream.client_id", clientWorkstreamId: "matched_stream.id", groupId: "matched_group.id",
      });
      const clientWorkstreamGroupTaskGrant = workContextPermissionSql("tasks.create", {
        clientId: "matched_stream.client_id", clientWorkstreamId: "matched_stream.id", groupId: "matched_group.id",
      });
      const organisationWorkstreamGroupViewGrant = workContextPermissionSql("groups.view", {
        groupId: "matched_group.id",
      });
      const organisationWorkstreamGroupTaskGrant = workContextPermissionSql("tasks.create", {
        groupId: "matched_group.id",
      });
      const groupViewGrant = workContextPermissionSql("groups.view", {
        clientId: "clients.id", clientWorkstreamId: "groups.client_workstream_id", groupId: "groups.id",
      });
      const groupTaskGrant = workContextPermissionSql("tasks.create", {
        clientId: "clients.id", clientWorkstreamId: "groups.client_workstream_id", groupId: "groups.id",
      });
      const clients = await transaction.query<{
        id: string; name: string; can_view: boolean; can_create_workstream: boolean;
      }>(
        `${workContextGrantCtes()}
         SELECT clients.id, clients.name, ${clientViewGrant} AS can_view,
                ${clientWorkstreamCreateGrant} AS can_create_workstream
         FROM nova.clients clients
         WHERE clients.organisation_id = $1 AND clients.archived_at IS NULL
           AND ${clientVisibilityGrant}
           AND (
             $3::text IS NULL OR ${workContextSearchMatch("clients.name")}
             OR EXISTS (
               SELECT 1 FROM nova.client_workstreams matched_stream
               WHERE matched_stream.organisation_id = clients.organisation_id
                 AND matched_stream.client_id = clients.id
                 AND matched_stream.archived_at IS NULL
                 AND ${clientWorkstreamVisibilityGrant("matched_stream")}
                 AND ${workContextSearchMatch("matched_stream.name")}
             )
             OR EXISTS (
               SELECT 1 FROM nova.client_workstreams matched_stream
               JOIN nova.work_groups matched_group
                 ON matched_group.client_workstream_id = matched_stream.id
                AND matched_group.organisation_id = matched_stream.organisation_id
                AND matched_group.archived_at IS NULL
               WHERE matched_stream.organisation_id = clients.organisation_id
                 AND matched_stream.client_id = clients.id
                 AND matched_stream.archived_at IS NULL
                 AND ${clientWorkstreamVisibilityGrant("matched_stream")}
                 AND ${clientWorkstreamGroupViewGrant}
                 AND (${workContextSearchMatch("matched_group.name")} OR (
                   ${clientWorkstreamGroupTaskGrant} AND ${workContextSearchMatch("'Task target'")}
                 ))
             )
           )
         ORDER BY clients.name, clients.id`,
        [actor.context.organisationId, actor.context.userId, searchPattern],
      );
      const visibleClients = clients.rows.filter(workContextClientIsVisible)
        .map(({ id: clientId, name }) => ({ id: clientId, name }));
      const clientWorkstreams = await transaction.query<{
        id: string; client_id: string; name: string; client_name: string;
        billing_policy_class: TaskBillingClass | null; billing_policy_revision: number;
        can_manage_billing_policy: boolean; can_view_workstream: boolean;
        can_create_group: boolean; can_create_task: boolean;
      }>(
        `${workContextGrantCtes()}
         SELECT workstreams.id, workstreams.client_id, workstreams.name, clients.name AS client_name,
                workstreams.billing_policy_class, workstreams.billing_policy_revision,
                ${clientWorkstreamBillingGrant("workstreams")} AS can_manage_billing_policy,
                ${clientWorkstreamViewGrant("workstreams")} AS can_view_workstream,
                ${clientWorkstreamGroupGrant("workstreams")} AS can_create_group,
                ${clientWorkstreamTaskGrant("workstreams")} AS can_create_task
         FROM nova.client_workstreams workstreams
         JOIN nova.clients clients ON clients.id = workstreams.client_id
          AND clients.organisation_id = workstreams.organisation_id
         WHERE workstreams.organisation_id = $1
           AND workstreams.archived_at IS NULL AND clients.archived_at IS NULL
           AND (${clientWorkstreamVisibilityGrant("workstreams")} OR ${clientWorkstreamTaskGrant("workstreams")})
           AND (
             $3::text IS NULL
             OR ${workContextSearchMatch("clients.name")}
             OR ${workContextSearchMatch("workstreams.name")}
             OR (${clientWorkstreamTaskGrant("workstreams")} AND ${workContextSearchAny("'Task target'", "'Client workstream target'")})
             OR EXISTS (
               SELECT 1 FROM nova.work_groups matched_group
               WHERE matched_group.client_workstream_id = workstreams.id
                 AND matched_group.organisation_id = workstreams.organisation_id
                 AND matched_group.archived_at IS NULL
                 AND ${workContextPermissionSql("groups.view", {
                   clientId: "workstreams.client_id", clientWorkstreamId: "workstreams.id", groupId: "matched_group.id",
                 })}
                 AND (${workContextSearchMatch("matched_group.name")} OR (
                   ${workContextPermissionSql("tasks.create", {
                     clientId: "workstreams.client_id", clientWorkstreamId: "workstreams.id", groupId: "matched_group.id",
                   })} AND ${workContextSearchMatch("'Task target'")}
                 ))
             )
           )
         ORDER BY clients.name, workstreams.name, workstreams.id`,
        [actor.context.organisationId, actor.context.userId, searchPattern],
      );
      const visibleClientWorkstreams = [];
      const taskCreationTargets = [];
      for (const workstream of clientWorkstreams.rows) {
        if (workContextWorkstreamIsVisible(workstream)) {
          visibleClientWorkstreams.push({
            id: workstream.id,
            client_id: workstream.client_id,
            name: workstream.name,
            client_name: workstream.client_name,
            billing_policy_class: workstream.billing_policy_class,
            billing_policy_revision: workstream.billing_policy_revision,
            billingPolicyClass: workstream.billing_policy_class,
            billingPolicyRevision: workstream.billing_policy_revision,
            canManageBillingPolicy: workstream.can_manage_billing_policy,
          });
        }
        if (workstream.can_create_task) taskCreationTargets.push({
          key: `client:${workstream.id}`,
          id: workstream.id,
          name: workstream.name,
          kind: "client" as const,
          clientName: workstream.client_name,
          billingPolicyClass: workstream.billing_policy_class,
          billingPolicyRevision: workstream.billing_policy_revision,
        });
      }
      const organisationWorkstreams = await transaction.query<{
        id: string; name: string; can_view_workstream: boolean; can_create_group: boolean;
      }>(
        `${workContextGrantCtes()}
         SELECT workstreams.id, workstreams.name,
                ${organisationWorkstreamViewGrant} AS can_view_workstream,
                ${organisationWorkstreamGroupGrant} AS can_create_group
         FROM nova.organisation_workstreams workstreams
         WHERE workstreams.organisation_id = $1 AND workstreams.archived_at IS NULL
           AND (${organisationWorkstreamVisibilityGrant} OR ${organisationTaskGrant})
           AND (
             $3::text IS NULL
             OR ${workContextSearchMatch("workstreams.name")}
             OR (${organisationTaskGrant} AND ${workContextSearchAny("'Task target'", "'Organisation workstream target'")})
             OR EXISTS (
               SELECT 1 FROM nova.work_groups matched_group
               WHERE matched_group.organisation_workstream_id = workstreams.id
                 AND matched_group.organisation_id = workstreams.organisation_id
                 AND matched_group.archived_at IS NULL
                 AND ${organisationWorkstreamGroupViewGrant}
                 AND (${workContextSearchMatch("matched_group.name")} OR (
                   ${organisationWorkstreamGroupTaskGrant} AND ${workContextSearchMatch("'Task target'")}
                 ))
             )
           )
         ORDER BY workstreams.name, workstreams.id`,
        [actor.context.organisationId, actor.context.userId, searchPattern],
      );
      const visibleOrganisationWorkstreams = organisationWorkstreams.rows
        .filter(workContextWorkstreamIsVisible)
        .map(({ id: workstreamId, name }) => ({ id: workstreamId, name }));
      const canCreateOrganisationTask = await hasPermission(
        transaction, actor.context.userId, actor.context.organisationId, "tasks.create");
      for (const workstream of organisationWorkstreams.rows) {
        if (canCreateOrganisationTask) taskCreationTargets.push({
          key: `organisation:${workstream.id}`,
          id: workstream.id,
          name: workstream.name,
          kind: "organisation" as const,
          billingPolicyClass: "non_billable",
          billingPolicyRevision: 1,
        });
      }
      const groups = await transaction.query<{
        id: string;
        client_workstream_id: string | null;
        organisation_workstream_id: string | null;
        client_id: string | null;
        client_name: string | null;
        client_workstream_name: string | null;
        client_billing_policy_class: TaskBillingClass | null;
        client_billing_policy_revision: number | null;
        organisation_workstream_name: string | null;
        name: string;
        can_view_group: boolean;
        can_create_task: boolean;
      }>(
        `${workContextGrantCtes()}
         SELECT groups.id, groups.client_workstream_id, groups.organisation_workstream_id, groups.name,
                clients.id AS client_id, clients.name AS client_name,
                client_workstreams.name AS client_workstream_name,
                client_workstreams.billing_policy_class AS client_billing_policy_class,
                client_workstreams.billing_policy_revision AS client_billing_policy_revision,
                organisation_workstreams.name AS organisation_workstream_name,
                ${groupViewGrant} AS can_view_group,
                ${groupTaskGrant} AS can_create_task
         FROM nova.work_groups groups
         LEFT JOIN nova.client_workstreams client_workstreams
           ON client_workstreams.id = groups.client_workstream_id
          AND client_workstreams.organisation_id = groups.organisation_id
         LEFT JOIN nova.clients clients
           ON clients.id = client_workstreams.client_id
          AND clients.organisation_id = groups.organisation_id
         LEFT JOIN nova.organisation_workstreams organisation_workstreams
           ON organisation_workstreams.id = groups.organisation_workstream_id
          AND organisation_workstreams.organisation_id = groups.organisation_id
         WHERE groups.organisation_id = $1 AND groups.archived_at IS NULL
           AND ((groups.client_workstream_id IS NOT NULL
                 AND client_workstreams.archived_at IS NULL AND clients.archived_at IS NULL)
             OR (groups.organisation_workstream_id IS NOT NULL
                 AND organisation_workstreams.archived_at IS NULL))
           AND (${groupViewGrant} OR ${groupTaskGrant})
           AND (
             $3::text IS NULL
             OR ${workContextSearchMatch("groups.name")}
             OR (${groupViewGrant} AND ${groupTaskGrant} AND ${workContextSearchMatch("'Task target'")})
             OR (NOT ${groupViewGrant} AND ${groupTaskGrant} AND ${workContextSearchAny(
               "'Task target'", "'Client workstream target'", "'Organisation workstream target'",
             )})
             OR (groups.client_workstream_id IS NOT NULL
               AND ${clientWorkstreamVisibilityGrant("client_workstreams")}
               AND ${workContextSearchAny("clients.name", "client_workstreams.name")})
             OR (groups.organisation_workstream_id IS NOT NULL
               AND ${organisationWorkstreamVisibilityGrant}
               AND ${workContextSearchMatch("organisation_workstreams.name")})
           )
         ORDER BY groups.name`,
        [actor.context.organisationId, actor.context.userId, searchPattern],
      );
      const visibleGroups = [];
      for (const group of groups.rows) {
        const kind: "client" | "organisation" = group.client_workstream_id ? "client" : "organisation";
        const parentId = group.client_workstream_id ?? group.organisation_workstream_id!;
        const canViewGroup = group.can_view_group;
        const canCreateGroupTask = group.can_create_task;
        const hasParentCreateTarget = taskCreationTargets.some((target) =>
          target.kind === kind && target.id === parentId,
        );
        if (canCreateGroupTask && !hasParentCreateTarget) {
          taskCreationTargets.push({
            key: `${kind}:${parentId}:group:${group.id}`,
            id: parentId,
            name: kind === "client" ? group.client_workstream_name! : group.organisation_workstream_name!,
            kind,
            ...(kind === "client" ? { clientName: group.client_name! } : {}),
            billingPolicyClass: kind === "client" ? group.client_billing_policy_class : "non_billable",
            billingPolicyRevision: kind === "client" ? group.client_billing_policy_revision : 1,
            requiredGroupId: group.id,
            groupName: group.name,
          });
        }
        if (canViewGroup || canCreateGroupTask) {
          visibleGroups.push({ ...group, canCreateTask: canCreateGroupTask, canViewGroup });
        }
      }
      return {
        clients: visibleClients,
        clientWorkstreams: visibleClientWorkstreams,
        organisationWorkstreams: visibleOrganisationWorkstreams,
        taskCreationTargets,
        canReceiveAssignments,
        groups: visibleGroups.map((group) => ({
          id: group.id,
          name: group.name,
          clientWorkstreamId: group.client_workstream_id,
          organisationWorkstreamId: group.organisation_workstream_id,
          canCreateTask: group.canCreateTask,
          canViewGroup: group.canViewGroup,
        })),
      };
    });
    return json(search ? searchAuthorizedWorkContext(result, search) : result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export type MyAssignmentFilters = Readonly<{
  limit: number;
  cursorAssignedAt: string | null;
  cursorAssignmentId: string | null;
  status: string | null;
  due: "any" | "overdue" | "today" | "upcoming" | "unscheduled";
  searchPattern: string | null;
}>;

function pageCursorBinding(status: string, due: string, search: string): string {
  const encoded = new TextEncoder().encode(JSON.stringify([status, due, search]));
  return Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatUtcTimeUuidCursor(timestamp: string, id: string, binding: string): string {
  return `${timestamp}~${id}~${binding}`;
}

function parseUtcTimeUuidCursor(
  value: string | null,
  expectedBinding: string,
): { timestamp: string; id: string } | null | undefined {
  if (!value) return null;
  const [timestamp, id, binding, ...extra] = value.split("~");
  if (!timestamp || !id || !binding || extra.length) return undefined;
  const timestampPattern = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}\+00$/;
  const timestampAsIso = timestamp.slice(0, 23).replace(" ", "T") + "Z";
  if (!/^[0-9a-f]+$/.test(binding) || binding !== expectedBinding ||
      !timestampPattern.test(timestamp) || !validTaskDueDate(timestamp.slice(0, 10)) ||
      !Number.isFinite(Date.parse(timestampAsIso)) || !uuidPattern.test(id)) return undefined;
  return { timestamp, id };
}

export function parseMyAssignmentFilters(request: Request): MyAssignmentFilters | undefined {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return undefined;

  const rawStatus = params.get("status") || "all";
  const statuses = new Set(["all", "assigned", "in_progress", "submitted", "awaiting_review", "changes_requested", "approved"]);
  if (!statuses.has(rawStatus)) return undefined;
  const rawDue = params.get("due") || "any";
  const dueFilters = new Set(["any", "overdue", "today", "upcoming", "unscheduled"]);
  if (!dueFilters.has(rawDue)) return undefined;

  const rawSearch = params.get("q")?.trim() || "";
  if (rawSearch.length > 100) return undefined;
  const searchPattern = rawSearch
    ? `%${rawSearch.replace(/[\\%^_]/g, "^$&")}%`
    : null;

  const status = rawStatus === "all" ? null : rawStatus;
  const cursor = parseUtcTimeUuidCursor(params.get("cursor"), pageCursorBinding(rawStatus, rawDue, rawSearch));
  if (cursor === undefined) return undefined;
  if (!cursor) {
    return {
      limit,
      cursorAssignedAt: null,
      cursorAssignmentId: null,
      status,
      due: rawDue as MyAssignmentFilters["due"],
      searchPattern,
    };
  }

  return {
    limit,
    cursorAssignedAt: cursor.timestamp,
    cursorAssignmentId: cursor.id,
    status,
    due: rawDue as MyAssignmentFilters["due"],
    searchPattern,
  };
}

export type MyAssignmentReadRow = Readonly<{
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  status: string;
  task_status: string;
  review_required: boolean;
  reviewer_person_id: string | null;
  review_blocked_reason: string | null;
  review_blocked_at: Date | null;
  resolution_source: string | null;
  due_date: string | null;
  due_date_revision: number;
  billing_class: TaskBillingClass;
  billing_policy_source: string;
  billing_policy_revision: number;
  correction_of_task_id: string | null;
  task_catalog_entry_id: string | null;
  task_catalog_revision: number | null;
  correction_reason: string | null;
  correction_title: string | null;
  correction_client_id: string | null;
  correction_client_workstream_id: string | null;
  correction_group_id: string | null;
  client_id: string | null;
  client_workstream_id: string | null;
  work_group_id: string | null;
  assigned_at: Date;
  cursor_assigned_at: string;
  can_view: boolean;
  can_edit_due_date: boolean;
  can_start: boolean;
  can_submit: boolean;
  can_request_reviewer: boolean;
  can_request_handover: boolean;
  has_pending_reviewer_request: boolean;
  has_pending_handover_request: boolean;
  correction_source_visible: boolean;
}>;

export function projectMyAssignmentSummary(row: MyAssignmentReadRow) {
  const canViewTask = row.can_view === true;
  const canEditDueDate = row.can_edit_due_date === true &&
    !["approved", "done", "cancelled"].includes(row.task_status);
  const actionCapabilities = ownAssignmentActionCapabilities({
    status: row.status,
    taskStatus: row.task_status,
    canStartPermission: row.can_start === true,
    canSubmitPermission: row.can_submit === true,
    canRequestReviewerPermission: row.can_request_reviewer === true,
    canRequestHandoverPermission: row.can_request_handover === true,
    hasPendingReviewerRequest: row.has_pending_reviewer_request === true,
    hasPendingHandoverRequest: row.has_pending_handover_request === true,
  });
  if (!canViewTask && !canEditDueDate && !Object.values(actionCapabilities).some(Boolean)) return null;

  const correctionOf: { taskId: string; title: string } | null =
    canViewTask && row.correction_of_task_id && row.correction_title &&
    row.correction_source_visible === true
      ? { taskId: row.correction_of_task_id, title: row.correction_title }
      : null;
  return {
    assignmentId: row.id,
    taskId: row.task_id,
    title: row.title,
    canViewTask,
    ...(canViewTask ? {
      description: row.description,
      taskStatus: row.task_status,
      reviewRequired: row.review_required,
      reviewerPersonId: row.reviewer_person_id,
      reviewBlockedReason: row.review_blocked_reason,
      reviewBlockedAt: row.review_blocked_at,
      resolutionSource: row.resolution_source,
    } : {}),
    status: row.status,
    dueDate: row.due_date,
    dueDateRevision: row.due_date_revision,
    canEditDueDate,
    ...actionCapabilities,
    ...(canViewTask ? {
      billingClass: row.billing_class,
      billingPolicySource: row.billing_policy_source,
      billingPolicyRevision: row.billing_policy_revision,
      taskDefinition: row.task_catalog_entry_id
        ? { entryId: row.task_catalog_entry_id, revision: row.task_catalog_revision }
        : null,
      isCorrection: row.correction_of_task_id !== null,
      correctionReason: row.correction_reason,
      correctionOf,
    } : {}),
  };
}

export function myAssignmentsReadSql(): string {
  const correctionSourceVisible = permissionExistsSql({
    actorId: "$2",
    organisationId: "$1",
    permissionKey: "'tasks.view'",
    clientId: "candidate_assignments.correction_client_id",
    clientWorkstreamId: "candidate_assignments.correction_client_workstream_id",
    groupId: "candidate_assignments.correction_group_id",
    taskId: "candidate_assignments.correction_of_task_id",
  });
  return `WITH actor_business_date AS MATERIALIZED (
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
   ), candidate_assignments AS MATERIALIZED (
     SELECT assignments.id, assignments.task_id, tasks.title, tasks.description,
           assignments.status, tasks.status AS task_status, assignments.review_required,
           assignments.reviewer_person_id, assignments.review_blocked_reason,
           assignments.review_blocked_at, assignments.resolution_source,
           tasks.due_date::text AS due_date, assignments.assigned_at,
           to_char(assignments.assigned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' AS cursor_assigned_at,
           tasks.due_date_revision, tasks.billing_class, tasks.billing_policy_source,
           tasks.billing_policy_revision, tasks.correction_of_task_id,
           tasks.task_catalog_entry_id, tasks.task_catalog_revision,
           tasks.correction_reason, correction_source.title AS correction_title,
           correction_workstreams.client_id AS correction_client_id,
           correction_source.client_workstream_id AS correction_client_workstream_id,
           correction_source.work_group_id AS correction_group_id,
           workstreams.client_id AS client_id,
           tasks.client_workstream_id, tasks.work_group_id,
           capabilities.can_view,
           capabilities.can_edit_due_date,
           capabilities.can_start,
           capabilities.can_submit,
           capabilities.can_request_reviewer,
           capabilities.can_request_handover,
           request_state.has_pending_reviewer_request,
           request_state.has_pending_handover_request
    FROM nova.task_assignments assignments
    JOIN nova.tasks tasks ON tasks.id = assignments.task_id
    LEFT JOIN nova.client_workstreams workstreams
      ON workstreams.id = tasks.client_workstream_id
    LEFT JOIN nova.tasks correction_source
      ON correction_source.id = tasks.correction_of_task_id
    LEFT JOIN nova.client_workstreams correction_workstreams
      ON correction_workstreams.id = correction_source.client_workstream_id
     CROSS JOIN LATERAL (
       SELECT
         COALESCE(bool_or(grants.permission_key = 'tasks.view'), false) AS can_view,
         COALESCE(bool_or(grants.permission_key = 'tasks.edit'), false)
           AND tasks.status::text NOT IN ('approved', 'done', 'cancelled') AS can_edit_due_date,
         COALESCE(bool_or(grants.permission_key = 'tasks.start'), false) AS can_start,
         COALESCE(bool_or(grants.permission_key = 'tasks.submit'), false) AS can_submit,
         COALESCE(bool_or(grants.permission_key = 'tasks.reviewer_request'), false) AS can_request_reviewer,
         COALESCE(bool_or(grants.permission_key = 'tasks.handover_request'), false) AS can_request_handover
       FROM active_grants grants
       WHERE grants.permission_key = ANY(ARRAY[
         'tasks.view', 'tasks.edit', 'tasks.start', 'tasks.submit',
         'tasks.reviewer_request', 'tasks.handover_request'
       ]::text[])
         AND (
           grants.scope = 'organisation'
           OR (grants.scope = 'client' AND grants.client_id = workstreams.client_id)
           OR (grants.scope = 'client_workstream' AND grants.client_workstream_id = tasks.client_workstream_id)
           OR (grants.scope = 'group' AND grants.group_id = tasks.work_group_id)
           OR (grants.scope = 'office' AND EXISTS (
             SELECT 1 FROM nova.person_office_assignments actor_offices
             WHERE actor_offices.person_id = $2
               AND actor_offices.office_id = grants.office_id
               AND actor_offices.effective_on <= grants.business_date
               AND (actor_offices.effective_until IS NULL OR actor_offices.effective_until >= grants.business_date)
           ))
           OR (grants.scope = 'organisation_department' AND EXISTS (
             SELECT 1 FROM nova.person_department_assignments actor_departments
             WHERE actor_departments.person_id = $2
               AND actor_departments.organisation_department_id = grants.organisation_department_id
               AND actor_departments.effective_on <= grants.business_date
               AND (actor_departments.effective_until IS NULL OR actor_departments.effective_until >= grants.business_date)
           ))
           -- This query has already constrained assignments.person_id = $2 and
           -- assignments.organisation_id = $1, so the current row proves the
           -- actor's assigned_work target for these six own-assignment keys.
           OR grants.scope = 'assigned_work'
         )
     ) capabilities
     CROSS JOIN LATERAL (
       SELECT
         EXISTS (
           SELECT 1 FROM nova.task_reviewer_requests reviewer_requests
           WHERE reviewer_requests.assignment_id = assignments.id
             AND reviewer_requests.status = 'pending'
             AND reviewer_requests.expires_at > clock_timestamp()
         ) AS has_pending_reviewer_request,
         EXISTS (
           SELECT 1 FROM nova.task_assignment_handover_requests handover_requests
           WHERE handover_requests.assignment_id = assignments.id
             AND handover_requests.status = 'pending'
             AND handover_requests.expires_at > clock_timestamp()
         ) AS has_pending_handover_request
       OFFSET 0
     ) request_state
    WHERE assignments.organisation_id = $1
      AND assignments.person_id = $2
      AND assignments.status <> 'cancelled'
      AND tasks.status <> 'cancelled'
      AND ($3::timestamptz IS NULL OR (assignments.assigned_at, assignments.id) < ($3::timestamptz, $4::uuid))
      AND ($5::text IS NULL OR assignments.status::text = $5)
      AND CASE $6::text
        WHEN 'overdue' THEN tasks.due_date < nova.person_business_date($2)
        WHEN 'today' THEN tasks.due_date = nova.person_business_date($2)
        WHEN 'upcoming' THEN tasks.due_date > nova.person_business_date($2)
          AND tasks.due_date <= nova.person_business_date($2) + 7
        WHEN 'unscheduled' THEN tasks.due_date IS NULL
        ELSE TRUE
      END
      AND ($7::text IS NULL OR tasks.title ILIKE $7 ESCAPE '^')
       AND (capabilities.can_view
        OR capabilities.can_edit_due_date
        OR (capabilities.can_start
            AND assignments.status::text IN ('assigned', 'in_progress', 'changes_requested')
            AND tasks.status::text IN ('backlog', 'ready', 'in_progress', 'returned', 'blocked'))
        OR (capabilities.can_submit AND assignments.status::text IN ('in_progress', 'changes_requested'))
        OR (capabilities.can_request_reviewer AND assignments.status::text NOT IN ('cancelled', 'approved')
            AND tasks.status::text <> 'cancelled' AND NOT request_state.has_pending_reviewer_request)
        OR (capabilities.can_request_handover AND assignments.status::text NOT IN ('cancelled', 'approved')
            AND tasks.status::text <> 'cancelled' AND NOT request_state.has_pending_handover_request))
     ORDER BY assignments.assigned_at DESC, assignments.id DESC
    LIMIT $8
  )
   SELECT candidate_assignments.*,
          ${correctionSourceVisible} AS correction_source_visible
  FROM candidate_assignments
  ORDER BY candidate_assignments.assigned_at DESC, candidate_assignments.id DESC`;
}

export async function readMyAssignments(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const filters = parseMyAssignmentFilters(request);
  if (!filters) return json({ error: "ASSIGNMENT_QUERY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query<MyAssignmentReadRow>(myAssignmentsReadSql(), [
        actor.context.organisationId,
        actor.context.userId,
        filters.cursorAssignedAt,
        filters.cursorAssignmentId,
        filters.status,
        filters.due,
        filters.searchPattern,
        filters.limit + 1,
      ]);
      const hasMore = rows.rows.length > filters.limit;
      const pageRows = rows.rows.slice(0, filters.limit);
      const visible = [];
      for (const row of pageRows) {
        const projected = projectMyAssignmentSummary(row);
        if (projected) visible.push(projected);
      }
      const last = pageRows[pageRows.length - 1];
      return {
        assignments: visible,
        hasMore,
        nextCursor: hasMore && last
          ? formatUtcTimeUuidCursor(last.cursor_assigned_at, last.id,
            pageCursorBinding(filters.status ?? "all", filters.due,
              new URL(request.url).searchParams.get("q")?.trim() || ""))
          : null,
        limit: filters.limit,
      };
    });
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export type VisibleTaskFilters = Readonly<{
  limit: number;
  cursorCreatedAt: string | null;
  cursorTaskId: string | null;
  status: string;
  due: "any" | "overdue" | "today" | "upcoming" | "unscheduled";
  searchPattern: string | null;
}>;

const taskStatuses = new Set([
  "all", "open", "backlog", "ready", "in_progress", "submitted", "approved",
  "done", "blocked", "returned", "cancelled",
]);

export function parseVisibleTaskFilters(request: Request): VisibleTaskFilters | undefined {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return undefined;

  const status = params.get("status") || "open";
  if (!taskStatuses.has(status)) return undefined;
  const rawDue = params.get("due") || "any";
  const dueFilters = new Set(["any", "overdue", "today", "upcoming", "unscheduled"]);
  if (!dueFilters.has(rawDue)) return undefined;
  const rawSearch = params.get("q")?.trim() || "";
  if (rawSearch.length > 100) return undefined;
  const searchPattern = rawSearch
    ? `%${rawSearch.replace(/[\\%^_]/g, "^$&")}%`
    : null;

  const cursor = parseUtcTimeUuidCursor(params.get("cursor"), pageCursorBinding(status, rawDue, rawSearch));
  if (cursor === undefined) return undefined;
  if (!cursor) {
    return {
      limit, cursorCreatedAt: null, cursorTaskId: null,
      status, due: rawDue as VisibleTaskFilters["due"], searchPattern,
    };
  }
  return {
    limit, cursorCreatedAt: cursor.timestamp, cursorTaskId: cursor.id,
    status, due: rawDue as VisibleTaskFilters["due"], searchPattern,
  };
}

type VisibleTaskReadRow = Readonly<{
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: Date;
  cursor_created_at: string;
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
  assignment_count: number;
}>;

export function visibleTasksReadSql(): string {
  return `WITH actor_business_date AS MATERIALIZED (
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
  ), candidate_tasks AS MATERIALIZED (
    SELECT tasks.id, tasks.title, tasks.description, tasks.status, tasks.priority,
           tasks.due_date::text AS due_date, tasks.created_at,
           to_char(tasks.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' AS cursor_created_at,
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
      AND ($3::timestamptz IS NULL OR (tasks.created_at, tasks.id) < ($3::timestamptz, $4::uuid))
      AND CASE $5::text
        WHEN 'all' THEN TRUE
        WHEN 'open' THEN tasks.status NOT IN ('approved', 'done', 'cancelled')
        ELSE tasks.status::text = $5
      END
      AND CASE $6::text
        WHEN 'overdue' THEN tasks.due_date < nova.person_business_date($2)
        WHEN 'today' THEN tasks.due_date = nova.person_business_date($2)
        WHEN 'upcoming' THEN tasks.due_date > nova.person_business_date($2)
          AND tasks.due_date <= nova.person_business_date($2) + 7
        WHEN 'unscheduled' THEN tasks.due_date IS NULL
        ELSE TRUE
      END
      AND ($7::text IS NULL OR tasks.title ILIKE $7 ESCAPE '^')
      AND ${permissionExistsSql({
        actorId: "$2",
        organisationId: "$1",
        permissionKey: "'tasks.view'",
        clientId: "client_workstreams.client_id",
        clientWorkstreamId: "tasks.client_workstream_id",
        groupId: "tasks.work_group_id",
        taskId: "tasks.id",
        allowedScopes: ["organisation", "client", "client_workstream", "group"],
      })}
    ORDER BY tasks.created_at DESC, tasks.id DESC
    LIMIT $8
  )
  SELECT candidate_tasks.*,
         (SELECT count(*)::integer FROM nova.task_assignments assignments
           WHERE assignments.task_id = candidate_tasks.id AND assignments.status <> 'cancelled') AS assignment_count
  FROM candidate_tasks
  ORDER BY created_at DESC, id DESC`;
}

export async function readVisibleTasks(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const filters = parseVisibleTaskFilters(request);
  if (!filters) return json({ error: "TASK_QUERY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const rows = await transaction.query<VisibleTaskReadRow>(visibleTasksReadSql(), [
        actor.context.organisationId,
        actor.context.userId,
        filters.cursorCreatedAt,
        filters.cursorTaskId,
        filters.status,
        filters.due,
        filters.searchPattern,
        filters.limit + 1,
      ]);
      const hasMore = rows.rows.length > filters.limit;
      const pageRows = rows.rows.slice(0, filters.limit);
      const lastRow = pageRows.at(-1);
      return {
        tasks: pageRows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          dueDate: row.due_date,
          createdAt: row.created_at,
          client: row.client_id ? { id: row.client_id, name: row.client_name } : null,
          workstream: row.client_workstream_id
            ? { id: row.client_workstream_id, name: row.workstream_name, kind: "client" }
            : { id: row.organisation_workstream_id, name: row.organisation_workstream_name, kind: "organisation" },
          group: row.work_group_id ? { id: row.work_group_id, name: row.work_group_name } : null,
          department: row.department_id ? { id: row.department_id, name: row.department_name } : null,
          assignmentCount: row.assignment_count,
        })),
        hasMore,
        nextCursor: hasMore && lastRow
          ? formatUtcTimeUuidCursor(lastRow.cursor_created_at, lastRow.id,
            pageCursorBinding(filters.status, filters.due,
              new URL(request.url).searchParams.get("q")?.trim() || ""))
          : null,
        limit: filters.limit,
      };
    });
    return json(result);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

type TaskCollectionReadRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  due_date_revision: number;
  billing_class: TaskBillingClass;
  billing_policy_source: string;
  billing_policy_revision: number;
  correction_of_task_id: string | null;
  task_catalog_entry_id: string | null;
  task_catalog_revision: number | null;
  correction_reason: string | null;
  correction_title: string | null;
  correction_source_visible: boolean;
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
  can_edit_due_date: boolean;
  can_assign: boolean;
  can_cancel: boolean;
  can_reassign: boolean;
  assignment_id: string | null;
  person_id: string | null;
  person_name: string | null;
  reviewer_person_id: string | null;
  reviewer_name: string | null;
  review_required: boolean | null;
  review_blocked_reason: string | null;
  review_blocked_at: Date | null;
  resolution_source: string | null;
  assignment_status: string | null;
};

/** One permission-filtered batch for the bounded legacy Admin task list. */
export function taskCollectionReadSql(): string {
  const taskPermission = (
    permissionKey: string,
    targetRelation: string,
    allowedScopes?: NonNullable<PermissionSqlReferences["allowedScopes"]>,
  ) => permissionExistsSql({
    actorId: "$1",
    organisationId: "$2",
    permissionKey: `'${permissionKey}'`,
    clientId: `${targetRelation}.client_id`,
    clientWorkstreamId: `${targetRelation}.client_workstream_id`,
    groupId: `${targetRelation}.work_group_id`,
    taskId: `${targetRelation}.id`,
    ...(allowedScopes ? { allowedScopes } : {}),
  });
  const correctionSourcePermission = permissionExistsSql({
    actorId: "$1",
    organisationId: "$2",
    permissionKey: "'tasks.view'",
    clientId: "visible_tasks.correction_client_id",
    clientWorkstreamId: "visible_tasks.correction_client_workstream_id",
    groupId: "visible_tasks.correction_group_id",
    taskId: "visible_tasks.correction_of_task_id",
  });
  return `${activeActorGrantCtes("$1")}, candidate_tasks AS MATERIALIZED (
    SELECT tasks.id, tasks.organisation_id, tasks.title, tasks.description, tasks.status, tasks.priority,
           tasks.due_date, tasks.due_date::text AS due_date_text, tasks.due_date_revision,
           tasks.billing_class, tasks.billing_policy_source, tasks.billing_policy_revision,
           tasks.correction_of_task_id, tasks.task_catalog_entry_id, tasks.task_catalog_revision,
           tasks.correction_reason, tasks.created_at,
           correction_source.title AS correction_title,
           correction_clients.id AS correction_client_id,
           correction_source.client_workstream_id AS correction_client_workstream_id,
           correction_source.work_group_id AS correction_group_id,
           clients.id AS client_id, clients.name AS client_name,
           client_workstreams.id AS client_workstream_id, client_workstreams.name AS workstream_name,
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
    LEFT JOIN nova.tasks correction_source
      ON correction_source.id = tasks.correction_of_task_id
    LEFT JOIN nova.client_workstreams correction_workstreams
      ON correction_workstreams.id = correction_source.client_workstream_id
    LEFT JOIN nova.clients correction_clients
      ON correction_clients.id = correction_workstreams.client_id
    WHERE tasks.organisation_id = $2
    ORDER BY tasks.due_date NULLS LAST, tasks.created_at DESC
    LIMIT 200
  ), task_visibility AS MATERIALIZED (
    SELECT candidate_tasks.*,
           ${taskPermission("tasks.view", "candidate_tasks", ["organisation", "client", "client_workstream", "group"])} AS can_view_broad
    FROM candidate_tasks
  ), visible_tasks AS MATERIALIZED (
    SELECT * FROM task_visibility WHERE can_view_broad
  ), task_permission_hints AS MATERIALIZED (
    SELECT visible_tasks.*,
           ${taskPermission("tasks.edit", "visible_tasks")} AS can_edit_due_date,
           ${taskPermission("tasks.assign", "visible_tasks")} AS can_assign,
           ${taskPermission("tasks.edit", "visible_tasks")} AS can_cancel,
           ${taskPermission("tasks.reassign", "visible_tasks")} AS can_reassign
    FROM visible_tasks
  )
  SELECT visible_tasks.id, visible_tasks.title, visible_tasks.description, visible_tasks.status, visible_tasks.priority,
         visible_tasks.due_date_text AS due_date, visible_tasks.due_date_revision,
         visible_tasks.billing_class, visible_tasks.billing_policy_source, visible_tasks.billing_policy_revision,
         visible_tasks.correction_of_task_id, visible_tasks.task_catalog_entry_id, visible_tasks.task_catalog_revision,
         visible_tasks.correction_reason, visible_tasks.correction_title,
         (visible_tasks.correction_of_task_id IS NOT NULL AND visible_tasks.correction_title IS NOT NULL
           AND ${correctionSourcePermission}) AS correction_source_visible,
         visible_tasks.client_id, visible_tasks.client_name, visible_tasks.client_workstream_id,
         visible_tasks.workstream_name, visible_tasks.organisation_workstream_id,
         visible_tasks.organisation_workstream_name, visible_tasks.work_group_id, visible_tasks.work_group_name,
         visible_tasks.department_id, visible_tasks.department_name,
         visible_tasks.can_edit_due_date, visible_tasks.can_assign, visible_tasks.can_cancel, visible_tasks.can_reassign,
         assignments.id AS assignment_id, assignments.person_id, people.display_name AS person_name,
         assignments.reviewer_person_id, reviewers.display_name AS reviewer_name,
         assignments.review_required, assignments.review_blocked_reason, assignments.review_blocked_at,
         assignments.resolution_source, assignments.status AS assignment_status
  FROM task_permission_hints visible_tasks
  LEFT JOIN nova.task_assignments assignments ON assignments.task_id = visible_tasks.id
  LEFT JOIN nova.people people ON people.id = assignments.person_id
  LEFT JOIN nova.people reviewers ON reviewers.id = assignments.reviewer_person_id
  ORDER BY visible_tasks.due_date NULLS LAST, visible_tasks.created_at DESC, assignments.assigned_at DESC`;
}

/** Run one set-based query and group its task/assignment rows into the Admin contract. */
export async function readTaskCollection(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await transaction.query<TaskCollectionReadRow>(taskCollectionReadSql(), [actorId, organisationId]);
  const tasks = new Map<string, {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    dueDate: string | null;
    dueDateRevision: number;
    canEditDueDate: boolean;
    canAssign: boolean;
    canCancel: boolean;
    billingClass: TaskBillingClass;
    billingPolicySource: string;
    billingPolicyRevision: number;
    taskDefinition: { entryId: string; revision: number | null } | null;
    isCorrection: boolean;
    correctionReason: string | null;
    correctionOf: { taskId: string; title: string } | null;
    client: { id: string; name: string } | null;
    workstream: { id: string | null; name: string | null; kind: "client" | "organisation" };
    group: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    assignments: Array<{
      id: string;
      personId: string;
      personName: string;
      reviewerPersonId: string | null;
      reviewerName: string | null;
      reviewRequired: boolean;
      reviewBlockedReason: string | null;
      reviewBlockedAt: Date | null;
      resolutionSource: string | null;
      status: string;
      canReassign: boolean;
    }>;
  }>();

  for (const row of result.rows) {
    let task = tasks.get(row.id);
    if (!task) {
      const correctionOf = row.correction_of_task_id && row.correction_title && row.correction_source_visible
        ? { taskId: row.correction_of_task_id, title: row.correction_title }
        : null;
      task = {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        dueDate: row.due_date,
        dueDateRevision: row.due_date_revision,
        canEditDueDate: row.can_edit_due_date,
        canAssign: row.can_assign,
        canCancel: row.can_cancel,
        billingClass: row.billing_class,
        billingPolicySource: row.billing_policy_source,
        billingPolicyRevision: row.billing_policy_revision,
        taskDefinition: row.task_catalog_entry_id
          ? { entryId: row.task_catalog_entry_id, revision: row.task_catalog_revision }
          : null,
        isCorrection: row.correction_of_task_id !== null,
        correctionReason: row.correction_of_task_id ? row.correction_reason : null,
        correctionOf,
        client: row.client_id ? { id: row.client_id, name: row.client_name! } : null,
        workstream: row.client_workstream_id
          ? { id: row.client_workstream_id, name: row.workstream_name, kind: "client" }
          : { id: row.organisation_workstream_id, name: row.organisation_workstream_name, kind: "organisation" },
        group: row.work_group_id ? { id: row.work_group_id, name: row.work_group_name! } : null,
        department: row.department_id ? { id: row.department_id, name: row.department_name! } : null,
        assignments: [],
      };
      tasks.set(row.id, task);
    }
    if (row.assignment_id) {
      task.assignments.push({
        id: row.assignment_id,
        personId: row.person_id!,
        personName: row.person_name!,
        reviewerPersonId: row.reviewer_person_id,
        reviewerName: row.reviewer_name,
        reviewRequired: row.review_required === true,
        reviewBlockedReason: row.review_blocked_reason,
        reviewBlockedAt: row.review_blocked_at,
        resolutionSource: row.resolution_source,
        status: row.assignment_status!,
        canReassign: row.can_reassign,
      });
    }
  }
  return [...tasks.values()];
}

export async function readTasks(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, (transaction) =>
      readTaskCollection(transaction, actor.context.userId, actor.context.organisationId));
    return json({ tasks: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
