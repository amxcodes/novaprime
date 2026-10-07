import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import {
  peopleDirectoryCursorBinding,
  peopleDirectoryPersonIdPattern,
  peopleDirectoryReadSql,
  parsePeopleDirectoryPage,
  projectAuthorizedPeopleDirectoryRows,
  projectPeopleDirectoryPage,
  projectPersonDirectoryRecord,
} from "./people-directory-model.js";
import type { PeopleDirectoryPageFilters, PeopleDirectoryReadRow, PeopleDirectoryRow } from "./people-directory-model.js";

export {
  peopleDirectoryCursorBinding,
  peopleDirectoryPersonIdPattern,
  peopleDirectoryPermissionScopes,
  peopleDirectoryReadSql,
  parsePeopleDirectoryPage,
  projectAuthorizedPeopleDirectoryRows,
  projectPeopleDirectoryPage,
  projectPersonDirectoryRecord,
} from "./people-directory-model.js";
export type { PeopleDirectoryPageFilters, PeopleDirectoryRow } from "./people-directory-model.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function withPeopleDirectoryActor<T>(
  request: Request,
  operation: (transaction: PoolClient, organisationId: string, actorId: string) => Promise<T | Response>,
): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      return operation(transaction, actor.context.organisationId, actor.context.userId);
    });
    if (result instanceof Response) return result;
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

function peopleDirectoryRows(
  transaction: PoolClient,
  organisationId: string,
  actorId: string,
  filters: PeopleDirectoryPageFilters,
  targetPersonId: string | null = null,
) {
  return transaction.query<PeopleDirectoryReadRow>(peopleDirectoryReadSql, [
    organisationId,
    actorId,
    filters.searchPattern,
    filters.cursorName,
    filters.cursorPersonId,
    filters.limit + 1,
    targetPersonId,
  ]);
}

export async function readPeopleDirectory(request: Request): Promise<Response> {
  const filters = parsePeopleDirectoryPage(request);
  if (!filters) return json({ error: "PEOPLE_DIRECTORY_QUERY_INVALID" }, 400);

  return withPeopleDirectoryActor(request, async (transaction, organisationId, actorId) => {
    const rows = await peopleDirectoryRows(transaction, organisationId, actorId, filters);
    const projected = projectAuthorizedPeopleDirectoryRows(rows.rows);
    if (!projected.permissionGranted) return json({ error: "PERMISSION_DENIED" }, 403);
    return projectPeopleDirectoryPage(projected.people, filters);
  });
}

export async function readPersonDirectoryRecord(request: Request, personId: string): Promise<Response> {
  if (!peopleDirectoryPersonIdPattern.test(personId)) return json({ error: "PERSON_NOT_FOUND" }, 404);
  const filters: PeopleDirectoryPageFilters = {
    limit: 1,
    query: "",
    searchPattern: null,
    cursorName: null,
    cursorPersonId: null,
    cursorBinding: peopleDirectoryCursorBinding(""),
  };

  return withPeopleDirectoryActor(request, async (transaction, organisationId, actorId) => {
    const rows = await peopleDirectoryRows(transaction, organisationId, actorId, filters, personId);
    const projected = projectAuthorizedPeopleDirectoryRows(rows.rows);
    if (!projected.permissionGranted) return json({ error: "PERMISSION_DENIED" }, 403);
    return projectPersonDirectoryRecord(projected.people, filters);
  });
}
