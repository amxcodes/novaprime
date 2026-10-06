import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

export const TASK_VIEW_SCHEMA_VERSION = 1;
export const TASK_VIEW_LIMIT = 12;
const MAX_TASK_VIEW_REVISION = 2_147_483_647;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const collections = new Set(["mine", "visible"]);
const statusesByCollection = Object.freeze({
  mine: new Set(["all", "assigned", "in_progress", "submitted", "awaiting_review", "changes_requested", "approved"]),
  visible: new Set(["open", "all", "backlog", "ready", "in_progress", "submitted", "approved", "done", "blocked", "returned", "cancelled"]),
});
const dueFilters = new Set(["any", "overdue", "today", "upcoming", "unscheduled"]);
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

type TaskViewInput = Readonly<{
  id?: string;
  name: string;
  collection: "mine" | "visible";
  status: string;
  due: string;
  search: string;
}>;

type TaskViewWriteInput = Readonly<{
  schemaVersion: number;
  expectedPersonId: string;
  expectedRevision: number;
  view: TaskViewInput;
}>;

type TaskViewDeleteInput = Readonly<{
  schemaVersion: number;
  expectedPersonId: string;
  expectedRevision: number;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTaskViewWriteInput(value: unknown): TaskViewWriteInput | undefined {
  if (!record(value) || Object.keys(value).some((key) =>
    !["schemaVersion", "expectedPersonId", "expectedRevision", "view"].includes(key))) return undefined;
  if (value.schemaVersion !== TASK_VIEW_SCHEMA_VERSION || typeof value.expectedPersonId !== "string" ||
      !uuidPattern.test(value.expectedPersonId) || !Number.isSafeInteger(value.expectedRevision) ||
      (value.expectedRevision as number) < 0 ||
      (value.expectedRevision as number) >= MAX_TASK_VIEW_REVISION || !record(value.view)) return undefined;

  const candidate = value.view;
  if (Object.keys(candidate).some((key) => !["id", "name", "collection", "status", "due", "search"].includes(key))) {
    return undefined;
  }
  const isUpdate = (value.expectedRevision as number) > 0;
  if ((isUpdate && (typeof candidate.id !== "string" || !uuidPattern.test(candidate.id))) ||
      (!isUpdate && Object.hasOwn(candidate, "id")) ||
      typeof candidate.name !== "string" || !candidate.name.trim() || candidate.name.trim().length > 40 ||
      typeof candidate.collection !== "string" || !collections.has(candidate.collection) ||
      typeof candidate.status !== "string" || !statusesByCollection[candidate.collection as "mine" | "visible"].has(candidate.status) ||
      typeof candidate.due !== "string" || !dueFilters.has(candidate.due) ||
      typeof candidate.search !== "string" || candidate.search.trim().length > 100) return undefined;

  return {
    schemaVersion: TASK_VIEW_SCHEMA_VERSION,
    expectedPersonId: value.expectedPersonId.toLowerCase(),
    expectedRevision: value.expectedRevision as number,
    view: {
      ...(isUpdate ? { id: (candidate.id as string).toLowerCase() } : {}),
      name: candidate.name.trim(),
      collection: candidate.collection as "mine" | "visible",
      status: candidate.status,
      due: candidate.due,
      search: candidate.search.trim(),
    },
  };
}

export function parseTaskViewDeleteInput(value: unknown): TaskViewDeleteInput | undefined {
  if (!record(value) || Object.keys(value).some((key) =>
    !["schemaVersion", "expectedPersonId", "expectedRevision"].includes(key))) return undefined;
  if (value.schemaVersion !== TASK_VIEW_SCHEMA_VERSION || typeof value.expectedPersonId !== "string" ||
      !uuidPattern.test(value.expectedPersonId) || !Number.isSafeInteger(value.expectedRevision) ||
      (value.expectedRevision as number) < 1 ||
      (value.expectedRevision as number) > MAX_TASK_VIEW_REVISION) return undefined;
  return {
    schemaVersion: TASK_VIEW_SCHEMA_VERSION,
    expectedPersonId: value.expectedPersonId.toLowerCase(),
    expectedRevision: value.expectedRevision as number,
  };
}

export const taskViewsOwnerReadSql = `SELECT id, schema_version, revision, sort_order,
       name, collection, status, due_filter AS due, search_text AS search
FROM nova.personal_task_views
WHERE organisation_id = $1 AND person_id = $2
ORDER BY sort_order, id
LIMIT 12`;

type TaskViewRow = Readonly<{
  id: string;
  schema_version: number;
  revision: number;
  sort_order: number;
  name: string;
  collection: "mine" | "visible";
  status: string;
  due: string;
  search: string;
}>;

function taskViewDto(row: TaskViewRow) {
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    revision: row.revision,
    sortOrder: row.sort_order,
    name: row.name,
    collection: row.collection,
    status: row.status,
    due: row.due,
    search: row.search,
  };
}

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function requestBody(request: Request): Promise<unknown | undefined> {
  const source = await request.text().catch(() => "");
  if (!source || source.length > 8192) return undefined;
  try { return JSON.parse(source) as unknown; } catch { return undefined; }
}

async function lockOwner(transaction: PoolClient, context: DatabaseRequestContext): Promise<boolean> {
  const owner = await transaction.query(
    `SELECT id FROM nova.people WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
    [context.userId, context.organisationId],
  );
  return owner.rows.length > 0;
}

async function listTaskViews(transaction: PoolClient, context: DatabaseRequestContext): Promise<TaskViewRow[]> {
  const result = await transaction.query<TaskViewRow>(taskViewsOwnerReadSql, [
    context.organisationId,
    context.userId,
  ]);
  return result.rows;
}

export async function readPersonalTaskViews(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    return await withDatabaseRequest(actor.context, async (transaction) => json({
      schemaVersion: TASK_VIEW_SCHEMA_VERSION,
      personId: actor.context.userId,
      views: (await listTaskViews(transaction, actor.context)).map(taskViewDto),
    }));
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function writePersonalTaskView(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = parseTaskViewWriteInput(await requestBody(request));
  if (!input) return json({ error: "TASK_VIEW_INPUT_INVALID" }, 400);
  if (input.expectedPersonId !== actor.context.userId.toLowerCase()) return json({ error: "TASK_VIEW_IDENTITY_CHANGED" }, 409);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await lockOwner(transaction, actor.context)) return { kind: "not_found" as const };
      if (input.expectedRevision === 0) {
        const count = await transaction.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM nova.personal_task_views
           WHERE organisation_id = $1 AND person_id = $2`,
          [actor.context.organisationId, actor.context.userId],
        );
        if ((count.rows[0]?.count ?? 0) >= TASK_VIEW_LIMIT) return { kind: "limit" as const };
        const position = await transaction.query<{ sort_order: number }>(
          `SELECT COALESCE(max(sort_order), -1) + 1 AS sort_order
           FROM nova.personal_task_views WHERE organisation_id = $1 AND person_id = $2`,
          [actor.context.organisationId, actor.context.userId],
        );
        const created = await transaction.query<TaskViewRow>(
          `INSERT INTO nova.personal_task_views (
             organisation_id, person_id, schema_version, revision, sort_order,
             name, collection, status, due_filter, search_text
           ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)
           RETURNING id, schema_version, revision, sort_order, name, collection,
                     status, due_filter AS due, search_text AS search`,
          [actor.context.organisationId, actor.context.userId, TASK_VIEW_SCHEMA_VERSION,
            position.rows[0]?.sort_order ?? 0, input.view.name, input.view.collection,
            input.view.status, input.view.due, input.view.search],
        );
        const row = created.rows[0];
        if (!row) throw new Error("PERSONAL_TASK_VIEW_CREATE_RESULT_MISSING");
        return { kind: "saved" as const, view: taskViewDto(row), created: true };
      }

      const updated = await transaction.query<TaskViewRow>(
        `UPDATE nova.personal_task_views
         SET name = $5, collection = $6, status = $7, due_filter = $8,
             search_text = $9, revision = revision + 1, updated_at = clock_timestamp()
         WHERE organisation_id = $1 AND person_id = $2 AND id = $3
           AND revision = $4 AND schema_version = $10
         RETURNING id, schema_version, revision, sort_order, name, collection,
                   status, due_filter AS due, search_text AS search`,
        [actor.context.organisationId, actor.context.userId, input.view.id, input.expectedRevision,
          input.view.name, input.view.collection, input.view.status, input.view.due, input.view.search,
          TASK_VIEW_SCHEMA_VERSION],
      );
      if (updated.rows[0]) return { kind: "saved" as const, view: taskViewDto(updated.rows[0]), created: false };
      const current = await transaction.query<TaskViewRow>(
        `SELECT id, schema_version, revision, sort_order, name, collection,
                status, due_filter AS due, search_text AS search
         FROM nova.personal_task_views
         WHERE organisation_id = $1 AND person_id = $2 AND id = $3`,
        [actor.context.organisationId, actor.context.userId, input.view.id],
      );
      const row = current.rows[0];
      if (!row) return { kind: "not_found" as const };
      return row.schema_version === TASK_VIEW_SCHEMA_VERSION
        ? { kind: "conflict" as const, current: taskViewDto(row) }
        : { kind: "unsupported" as const, current: taskViewDto(row) };
    });
    if (result.kind === "not_found") return json({ error: "TASK_VIEW_NOT_FOUND" }, 404);
    if (result.kind === "limit") return json({ error: "TASK_VIEW_LIMIT_REACHED", limit: TASK_VIEW_LIMIT }, 409);
    if (result.kind === "conflict") return json({ error: "TASK_VIEW_CONFLICT", current: result.current }, 409);
    if (result.kind === "unsupported") return json({ error: "TASK_VIEW_SCHEMA_UNSUPPORTED", current: result.current }, 409);
    return json({
      schemaVersion: TASK_VIEW_SCHEMA_VERSION,
      personId: actor.context.userId,
      view: result.view,
    }, result.created ? 201 : 200);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function deletePersonalTaskView(request: Request, viewId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(viewId)) return json({ error: "TASK_VIEW_NOT_FOUND" }, 404);
  const input = parseTaskViewDeleteInput(await requestBody(request));
  if (!input) return json({ error: "TASK_VIEW_INPUT_INVALID" }, 400);
  if (input.expectedPersonId !== actor.context.userId.toLowerCase()) return json({ error: "TASK_VIEW_IDENTITY_CHANGED" }, 409);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await lockOwner(transaction, actor.context)) return { kind: "not_found" as const };
      const deleted = await transaction.query<{ sort_order: number }>(
        `DELETE FROM nova.personal_task_views
         WHERE organisation_id = $1 AND person_id = $2 AND id = $3
           AND revision = $4 AND schema_version = $5
         RETURNING sort_order`,
        [actor.context.organisationId, actor.context.userId, viewId,
          input.expectedRevision, TASK_VIEW_SCHEMA_VERSION],
      );
      if (deleted.rows[0]) {
        await transaction.query(
          `UPDATE nova.personal_task_views
           SET sort_order = sort_order - 1,
               revision = revision + 1,
               updated_at = clock_timestamp()
           WHERE organisation_id = $1 AND person_id = $2 AND sort_order > $3`,
          [actor.context.organisationId, actor.context.userId, deleted.rows[0].sort_order],
        );
        return { kind: "deleted" as const };
      }
      const current = await transaction.query<TaskViewRow>(
        `SELECT id, schema_version, revision, sort_order, name, collection,
                status, due_filter AS due, search_text AS search
         FROM nova.personal_task_views
         WHERE organisation_id = $1 AND person_id = $2 AND id = $3`,
        [actor.context.organisationId, actor.context.userId, viewId],
      );
      const row = current.rows[0];
      if (!row) return { kind: "not_found" as const };
      return row.schema_version === TASK_VIEW_SCHEMA_VERSION
        ? { kind: "conflict" as const, current: taskViewDto(row) }
        : { kind: "unsupported" as const, current: taskViewDto(row) };
    });
    if (result.kind === "not_found") return json({ error: "TASK_VIEW_NOT_FOUND" }, 404);
    if (result.kind === "conflict") return json({ error: "TASK_VIEW_CONFLICT", current: result.current }, 409);
    if (result.kind === "unsupported") return json({ error: "TASK_VIEW_SCHEMA_UNSUPPORTED", current: result.current }, 409);
    return json({ schemaVersion: TASK_VIEW_SCHEMA_VERSION, personId: actor.context.userId, deleted: viewId.toLowerCase() });
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
