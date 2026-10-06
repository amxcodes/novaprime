import type { PoolClient } from "pg";
import { withDatabaseRequest } from "../db.js";
import { hasPermission, normalActor, permissionExistsSql } from "./work-context.js";
import { parseTaskComposerSearchInput, taskComposerSearchPattern, type TaskComposerSearchInput } from "./task-composer-search-model.js";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const searchLimit = 40;

type TargetContext = Readonly<{
  id: string;
  kind: "client" | "organisation";
  clientId: string | null;
  groupId: string | null;
}>;

async function resolveCreateTarget(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  input: TaskComposerSearchInput,
): Promise<TargetContext | "TARGET_NOT_FOUND" | "PERMISSION_DENIED"> {
  let clientId: string | null = null;
  if (input.kind === "client") {
    const result = await transaction.query<{ id: string; client_id: string }>(
      `SELECT workstreams.id, workstreams.client_id
       FROM nova.client_workstreams workstreams
       JOIN nova.clients clients
         ON clients.id = workstreams.client_id
        AND clients.organisation_id = workstreams.organisation_id
       WHERE workstreams.id = $1 AND workstreams.organisation_id = $2
         AND workstreams.archived_at IS NULL AND clients.archived_at IS NULL`,
      [input.id, organisationId],
    );
    const row = result.rows[0];
    if (!row) return "TARGET_NOT_FOUND";
    clientId = row.client_id;
  } else {
    const result = await transaction.query<{ id: string }>(
      `SELECT id FROM nova.organisation_workstreams
       WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`,
      [input.id, organisationId],
    );
    if (!result.rows[0]) return "TARGET_NOT_FOUND";
  }

  if (input.groupId) {
    const group = await transaction.query<{ id: string }>(
      `SELECT id FROM nova.work_groups
       WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL
         AND (($3::uuid IS NOT NULL AND client_workstream_id = $3)
           OR ($4::uuid IS NOT NULL AND organisation_workstream_id = $4))`,
      [input.groupId, organisationId, input.kind === "client" ? input.id : null,
        input.kind === "organisation" ? input.id : null],
    );
    if (!group.rows[0]) return "TARGET_NOT_FOUND";
  }

  const permitted = await hasPermission(transaction, actorId, organisationId, "tasks.create", {
    ...(clientId ? { clientId } : {}),
    ...(input.kind === "client" ? { clientWorkstreamId: input.id } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
  });
  if (!permitted) return "PERMISSION_DENIED";
  return {
    id: input.id,
    kind: input.kind,
    clientId,
    groupId: input.groupId || null,
  };
}

function targetFailure(result: TargetContext | "TARGET_NOT_FOUND" | "PERMISSION_DENIED") {
  if (result === "TARGET_NOT_FOUND") return json({ error: result }, 404);
  if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
  return null;
}

export async function readTaskComposerCatalogOptions(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = parseTaskComposerSearchInput(request);
  if (!input) return json({ error: "TASK_COMPOSER_SEARCH_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const target = await resolveCreateTarget(transaction, actor.context.userId, actor.context.organisationId, input);
      const failure = targetFailure(target);
      if (failure) return failure;
      const canViewCatalog = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.view");
      const canManageCatalog = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage");
      if (!canViewCatalog && !canManageCatalog) return json({ error: "PERMISSION_DENIED" }, 403);
      const entries = await transaction.query<{
        id: string; title: string; description: string | null; priority: string; revision: number;
      }>(
        `SELECT id, title, description, priority, revision
         FROM nova.task_catalog_entries
         WHERE organisation_id = $1 AND archived_at IS NULL
           AND ($2::text IS NULL OR title ILIKE $2 ESCAPE '^')
         ORDER BY lower(title), id
         LIMIT $3`,
        [actor.context.organisationId, taskComposerSearchPattern(input.search), searchLimit],
      );
      return json({ entries: entries.rows, permissions: { view: canViewCatalog, manage: canManageCatalog } });
    });
    return result;
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readTaskComposerDepartments(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = parseTaskComposerSearchInput(request);
  if (!input) return json({ error: "TASK_COMPOSER_SEARCH_INVALID" }, 400);
  try {
    return await withDatabaseRequest(actor.context, async (transaction) => {
      const target = await resolveCreateTarget(transaction, actor.context.userId, actor.context.organisationId, input);
      const failure = targetFailure(target);
      if (failure) return failure;
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "organisation.settings.manage")) {
        return json({ error: "PERMISSION_DENIED" }, 403);
      }
      const departments = await transaction.query<{ id: string; name: string }>(
        `SELECT id, name
         FROM nova.organisation_departments
         WHERE organisation_id = $1
           AND ($2::text IS NULL OR name ILIKE $2 ESCAPE '^')
         ORDER BY lower(name), id
         LIMIT $3`,
        [actor.context.organisationId, taskComposerSearchPattern(input.search), searchLimit],
      );
      return json({ departments: departments.rows });
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

function correctionSourcesSql(): string {
  const canViewSource = permissionExistsSql({
    actorId: "$2",
    organisationId: "$1",
    permissionKey: "'tasks.view'",
    clientId: "client_workstreams.client_id",
    clientWorkstreamId: "tasks.client_workstream_id",
    groupId: "tasks.work_group_id",
    taskId: "tasks.id",
    allowedScopes: ["organisation", "client", "client_workstream", "group"],
  });
  return `WITH actor_business_date AS MATERIALIZED (
    SELECT nova.person_business_date($2) AS business_date
  ), active_grants AS MATERIALIZED (
    SELECT actor_date.business_date, grants.person_id, grants.permission_key, grants.scope,
           grants.client_id, grants.client_workstream_id, grants.group_id,
           grants.office_id, grants.organisation_department_id
    FROM nova.person_role_assignments assignments
    CROSS JOIN actor_business_date actor_date
    JOIN nova.roles roles ON roles.id = assignments.role_id
    JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
    WHERE assignments.person_id = $2
      AND assignments.effective_on <= actor_date.business_date
      AND (assignments.effective_until IS NULL OR assignments.effective_until >= actor_date.business_date)
      AND roles.archived_at IS NULL
  )
  SELECT tasks.id, tasks.title, tasks.status,
         COALESCE(client_workstreams.id, organisation_workstreams.id) AS workstream_id,
         CASE WHEN client_workstreams.id IS NOT NULL THEN 'client' ELSE 'organisation' END AS workstream_kind
  FROM nova.tasks
  LEFT JOIN nova.client_workstreams
    ON client_workstreams.id = tasks.client_workstream_id
   AND client_workstreams.organisation_id = tasks.organisation_id
   AND client_workstreams.archived_at IS NULL
  LEFT JOIN nova.clients
    ON clients.id = client_workstreams.client_id
   AND clients.organisation_id = tasks.organisation_id
   AND clients.archived_at IS NULL
  LEFT JOIN nova.organisation_workstreams
    ON organisation_workstreams.id = tasks.organisation_workstream_id
   AND organisation_workstreams.organisation_id = tasks.organisation_id
   AND organisation_workstreams.archived_at IS NULL
  LEFT JOIN nova.work_groups
    ON work_groups.id = tasks.work_group_id
   AND work_groups.organisation_id = tasks.organisation_id
   AND work_groups.archived_at IS NULL
  WHERE tasks.organisation_id = $1
    AND tasks.status IN ('approved', 'done')
    AND tasks.correction_of_task_id IS NULL
    AND (($3::text = 'client' AND tasks.client_workstream_id = $4::uuid AND clients.id IS NOT NULL)
      OR ($3::text = 'organisation' AND tasks.organisation_workstream_id = $4::uuid AND organisation_workstreams.id IS NOT NULL))
    AND ($5::text IS NULL OR tasks.title ILIKE $5 ESCAPE '^')
    AND ${canViewSource}
  ORDER BY lower(tasks.title), tasks.id
  LIMIT $6`;
}

export async function readTaskComposerCorrectionSources(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = parseTaskComposerSearchInput(request);
  if (!input) return json({ error: "TASK_COMPOSER_SEARCH_INVALID" }, 400);
  try {
    return await withDatabaseRequest(actor.context, async (transaction) => {
      const target = await resolveCreateTarget(transaction, actor.context.userId, actor.context.organisationId, input);
      const failure = targetFailure(target);
      if (failure) return failure;
      const tasks = await transaction.query<{
        id: string; title: string; status: string; workstream_id: string; workstream_kind: "client" | "organisation";
      }>(correctionSourcesSql(), [
        actor.context.organisationId,
        actor.context.userId,
        input.kind,
        input.id,
        taskComposerSearchPattern(input.search),
        searchLimit,
      ]);
      return json({ tasks: tasks.rows.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        isCorrection: false,
        workstream: { id: task.workstream_id, kind: task.workstream_kind },
      })) });
    });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
