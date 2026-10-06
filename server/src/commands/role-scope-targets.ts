import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import {
  parseRoleScopeTargetSearch,
  roleScopeTargetPermissionSql,
  roleScopeTargetSql,
} from "./role-scope-targets-model.js";

export {
  parseRoleScopeTargetSearch,
  roleScopeTargetPermissionSql,
  roleScopeTargetSql,
  roleTargetScopes,
} from "./role-scope-targets-model.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function readRoleScopeTargets(request: Request): Promise<Response> {
  const filters = parseRoleScopeTargetSearch(request);
  if (!filters) return json({ error: "ROLE_SCOPE_TARGET_SEARCH_INVALID" }, 400);
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }
  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction: PoolClient) => {
      const permission = await transaction.query<{ permitted: boolean }>(
        roleScopeTargetPermissionSql,
        [actor.context.userId, actor.context.organisationId],
      );
      if (permission.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query<{ id: string; name: string }>(
        roleScopeTargetSql(filters.scope),
        [actor.context.organisationId, filters.query, filters.limit],
      );
      return { options: rows.rows.map(({ id, name }) => ({ id, name })) };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
