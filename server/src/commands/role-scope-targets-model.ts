export const roleTargetScopes = [
  "office",
  "organisation_department",
  "client",
  "client_workstream",
  "group",
] as const;

export type RoleTargetScope = typeof roleTargetScopes[number];

export type RoleScopeTargetSearch = Readonly<{
  scope: RoleTargetScope;
  query: string;
  limit: number;
}>;

const maximumQueryLength = 100;
const maximumResults = 30;

export function parseRoleScopeTargetSearch(request: Request): RoleScopeTargetSearch | undefined {
  const params = new URL(request.url).searchParams;
  const scopes = params.getAll("scope");
  const queries = params.getAll("q");
  if (scopes.length !== 1 || queries.length > 1) return undefined;
  const scope = scopes[0] as RoleTargetScope;
  if (!(roleTargetScopes as readonly string[]).includes(scope)) return undefined;
  const query = (queries[0] ?? "").normalize("NFC").trim().toLowerCase();
  if (query.length > maximumQueryLength || query.includes("\u0000")) return undefined;
  return { scope, query, limit: maximumResults };
}

/** Static, organization-bound queries; the endpoint exposes only IDs and display names. */
export function roleScopeTargetSql(scope: RoleTargetScope): string {
  const tables: Readonly<Record<RoleTargetScope, string>> = {
    office: `SELECT targets.id, targets.name
             FROM nova.offices targets
             WHERE targets.organisation_id = $1 AND targets.archived_at IS NULL
               AND ($2 = '' OR position($2 in lower(targets.name)) > 0)
             ORDER BY targets.name, targets.id LIMIT $3`,
    organisation_department: `SELECT targets.id, targets.name
             FROM nova.organisation_departments targets
             WHERE targets.organisation_id = $1 AND targets.archived_at IS NULL
               AND ($2 = '' OR position($2 in lower(targets.name)) > 0)
             ORDER BY targets.name, targets.id LIMIT $3`,
    client: `SELECT targets.id, targets.name
             FROM nova.clients targets
             WHERE targets.organisation_id = $1 AND targets.archived_at IS NULL
               AND ($2 = '' OR position($2 in lower(targets.name)) > 0)
             ORDER BY targets.name, targets.id LIMIT $3`,
    client_workstream: `SELECT targets.id, targets.name
             FROM nova.client_workstreams targets
             JOIN nova.clients clients ON clients.id = targets.client_id
               AND clients.organisation_id = targets.organisation_id AND clients.archived_at IS NULL
             WHERE targets.organisation_id = $1 AND targets.archived_at IS NULL
               AND ($2 = '' OR position($2 in lower(targets.name)) > 0)
             ORDER BY targets.name, targets.id LIMIT $3`,
    group: `SELECT targets.id, targets.name
             FROM nova.work_groups targets
             WHERE targets.organisation_id = $1 AND targets.archived_at IS NULL
               AND ($2 = '' OR position($2 in lower(targets.name)) > 0)
               AND (
                 EXISTS (
                   SELECT 1 FROM nova.client_workstreams workstreams
                   JOIN nova.clients clients ON clients.id = workstreams.client_id
                     AND clients.organisation_id = workstreams.organisation_id
                   WHERE workstreams.id = targets.client_workstream_id
                     AND workstreams.organisation_id = targets.organisation_id
                     AND workstreams.archived_at IS NULL AND clients.archived_at IS NULL
                 ) OR EXISTS (
                   SELECT 1 FROM nova.organisation_workstreams workstreams
                   WHERE workstreams.id = targets.organisation_workstream_id
                     AND workstreams.organisation_id = targets.organisation_id
                     AND workstreams.archived_at IS NULL
                 )
               )
             ORDER BY targets.name, targets.id LIMIT $3`,
  };
  return tables[scope];
}

export const roleScopeTargetPermissionSql = `SELECT EXISTS (
  SELECT 1
  FROM nova.person_role_assignments assignments
  JOIN nova.roles roles ON roles.id = assignments.role_id
  JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
  WHERE assignments.person_id = $1
    AND roles.organisation_id = $2
    AND assignments.effective_on <= nova.person_business_date($1)
    AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
    AND roles.archived_at IS NULL
    AND grants.permission_key = 'roles.view'
    AND grants.scope = 'organisation'
) AS permitted`;
