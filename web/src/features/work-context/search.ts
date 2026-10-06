import type { WorkContextExplorerProjection, WorkContextGroupSummary } from "./explorer-contracts";

export interface WorkContextSearchResult {
  projection: WorkContextExplorerProjection;
  hasMatches: boolean;
  summary: WorkContextSearchSummary;
}

export interface WorkContextSearchSummary {
  clientContexts: number;
  workstreams: number;
  visibleGroups: number;
  taskTargets: number;
}

export function formatWorkContextSearchSummary(summary: WorkContextSearchSummary): string {
  return `Showing ${summary.clientContexts} client ${summary.clientContexts === 1 ? "context" : "contexts"}, ` +
    `${summary.workstreams} workstream${summary.workstreams === 1 ? "" : "s"}, ` +
    `${summary.visibleGroups} visible group${summary.visibleGroups === 1 ? "" : "s"}, and ` +
    `${summary.taskTargets} eligible task creation target${summary.taskTargets === 1 ? "" : "s"} in this response.`;
}

function summarize(projection: WorkContextExplorerProjection): WorkContextSearchSummary {
  return {
    clientContexts: projection.clients.length,
    workstreams: projection.clientWorkstreams.length + projection.organisationWorkstreams.length,
    visibleGroups: projection.groups.filter((group) => group.canViewGroup).length,
    taskTargets: projection.workstreamTaskTargets.length +
      projection.groups.filter((group) => !group.canViewGroup && group.canCreateTask).length,
  };
}

function contains(query: string, ...labels: Array<string | null | undefined>): boolean {
  return labels.some((label) => typeof label === "string" && label.toLocaleLowerCase().includes(query));
}

function visibleGroupMatches(query: string, group: WorkContextGroupSummary): boolean {
  return contains(query, group.name, group.canCreateTask ? "Task target" : null);
}

function createOnlyTargetMatches(query: string, group: WorkContextGroupSummary): boolean {
  return contains(
    query,
    group.name,
    "Task target",
    group.clientWorkstreamId ? "Client workstream target" : "Organisation workstream target",
  );
}

function workstreamTaskTargetMatches(
  query: string,
  target: WorkContextExplorerProjection["workstreamTaskTargets"][number],
): boolean {
  return contains(
    query,
    target.name,
    target.clientName,
    "Task target",
    target.kind === "client" ? "Client workstream target" : "Organisation workstream target",
  );
}

/**
 * Filters only the already-authorized work-context projection. Browse rows
 * remain browse-scoped; create-only targets stay in their separate projection.
 */
export function searchWorkContextProjection(
  projection: WorkContextExplorerProjection,
  rawQuery: string,
): WorkContextSearchResult {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return { projection, hasMatches: true, summary: summarize(projection) };

  const clientById = new Map(projection.clients.map((client) => [client.id, client]));
  const streamsByClientId = new Map<string, typeof projection.clientWorkstreams[number][]>();
  for (const workstream of projection.clientWorkstreams) {
    const rows = streamsByClientId.get(workstream.clientId) ?? [];
    rows.push(workstream);
    streamsByClientId.set(workstream.clientId, rows);
  }
  const visibleGroupsByClientWorkstream = new Map<string, WorkContextGroupSummary[]>();
  const visibleGroupsByOrganisationWorkstream = new Map<string, WorkContextGroupSummary[]>();
  for (const group of projection.groups) {
    if (!group.canViewGroup) continue;
    if (group.clientWorkstreamId) {
      const rows = visibleGroupsByClientWorkstream.get(group.clientWorkstreamId) ?? [];
      rows.push(group);
      visibleGroupsByClientWorkstream.set(group.clientWorkstreamId, rows);
    }
    if (group.organisationWorkstreamId) {
      const rows = visibleGroupsByOrganisationWorkstream.get(group.organisationWorkstreamId) ?? [];
      rows.push(group);
      visibleGroupsByOrganisationWorkstream.set(group.organisationWorkstreamId, rows);
    }
  }

  const matchedClients: typeof projection.clients[number][] = [];
  const matchedClientWorkstreams: typeof projection.clientWorkstreams[number][] = [];
  const directlyMatchedClientWorkstreamIds = new Set<string>();
  const matchedVisibleGroupIds = new Set<string>();
  const clientIds = new Set([...clientById.keys(), ...streamsByClientId.keys()]);

  for (const clientId of clientIds) {
    const client = clientById.get(clientId);
    const workstreams = streamsByClientId.get(clientId) ?? [];
    const clientLabel = client?.name ?? workstreams.find((workstream) => workstream.clientName)?.clientName ?? "Client context";
    const clientMatches = contains(query, clientLabel);
    let hasDescendantMatch = false;

    for (const workstream of workstreams) {
      const visibleGroups = visibleGroupsByClientWorkstream.get(workstream.id) ?? [];
      const workstreamMatches = clientMatches || contains(query, workstream.name);
      if (clientMatches || contains(query, workstream.name)) {
        directlyMatchedClientWorkstreamIds.add(workstream.id);
      }
      const matchingGroups = workstreamMatches
        ? visibleGroups
        : visibleGroups.filter((group) => visibleGroupMatches(query, group));
      if (!workstreamMatches && matchingGroups.length === 0) continue;

      matchedClientWorkstreams.push(workstream);
      for (const group of matchingGroups) matchedVisibleGroupIds.add(group.id);
      hasDescendantMatch = true;
    }

    if (client && (clientMatches || hasDescendantMatch)) matchedClients.push(client);
    // Context-only client labels are derived from a visible workstream. Keep
    // that workstream as the parent source; never synthesize a browse record.
  }

  const matchedOrganisationWorkstreams: typeof projection.organisationWorkstreams[number][] = [];
  const directlyMatchedOrganisationWorkstreamIds = new Set<string>();
  for (const workstream of projection.organisationWorkstreams) {
    const visibleGroups = visibleGroupsByOrganisationWorkstream.get(workstream.id) ?? [];
    const workstreamMatches = contains(query, workstream.name);
    if (workstreamMatches) directlyMatchedOrganisationWorkstreamIds.add(workstream.id);
    const matchingGroups = workstreamMatches
      ? visibleGroups
      : visibleGroups.filter((group) => visibleGroupMatches(query, group));
    if (!workstreamMatches && matchingGroups.length === 0) continue;

    matchedOrganisationWorkstreams.push(workstream);
    for (const group of matchingGroups) matchedVisibleGroupIds.add(group.id);
  }

  const clientWorkstreamIds = new Set(projection.clientWorkstreams.map((workstream) => workstream.id));
  const organisationWorkstreamIds = new Set(projection.organisationWorkstreams.map((workstream) => workstream.id));
  for (const group of projection.groups) {
    if (!group.canViewGroup) continue;
    const hasProjectedParent = group.clientWorkstreamId
      ? clientWorkstreamIds.has(group.clientWorkstreamId)
      : group.organisationWorkstreamId
        ? organisationWorkstreamIds.has(group.organisationWorkstreamId)
        : false;
    if (!hasProjectedParent && visibleGroupMatches(query, group)) matchedVisibleGroupIds.add(group.id);
  }

  const matchedCreateOnlyTargetIds = new Set(projection.groups
    .filter((group) => !group.canViewGroup && group.canCreateTask && (
      createOnlyTargetMatches(query, group) ||
      (group.clientWorkstreamId !== null && directlyMatchedClientWorkstreamIds.has(group.clientWorkstreamId)) ||
      (group.organisationWorkstreamId !== null && directlyMatchedOrganisationWorkstreamIds.has(group.organisationWorkstreamId))
    ))
    .map((group) => group.id));
  const groups = projection.groups.filter((group) =>
    matchedVisibleGroupIds.has(group.id) || matchedCreateOnlyTargetIds.has(group.id),
  );
  const workstreamTaskTargets = projection.workstreamTaskTargets.filter((target) =>
    workstreamTaskTargetMatches(query, target),
  );
  const filteredProjection: WorkContextExplorerProjection = {
    clients: matchedClients,
    clientWorkstreams: matchedClientWorkstreams,
    organisationWorkstreams: matchedOrganisationWorkstreams,
    workstreamTaskTargets,
    groups,
  };

  return {
    projection: filteredProjection,
    hasMatches: matchedClients.length > 0 || matchedClientWorkstreams.length > 0 ||
      matchedOrganisationWorkstreams.length > 0 || workstreamTaskTargets.length > 0 || groups.length > 0,
    summary: summarize(filteredProjection),
  };
}
