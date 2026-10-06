type WorkstreamRow = { id: string; name: string; client_id?: string; client_name?: string };
type GroupRow = {
  id: string;
  name: string;
  clientWorkstreamId: string | null;
  organisationWorkstreamId: string | null;
  canViewGroup: boolean;
  canCreateTask: boolean;
};
type TaskTargetRow = {
  id: string;
  name: string;
  kind: "client" | "organisation";
  clientName?: string;
  requiredGroupId?: string;
};

export type WorkContextSearchSource = {
  clients: Array<{ id: string; name: string }>;
  clientWorkstreams: Array<WorkstreamRow>;
  organisationWorkstreams: Array<WorkstreamRow>;
  taskCreationTargets: Array<TaskTargetRow>;
  groups: Array<GroupRow>;
};

function includes(query: string, ...values: Array<string | null | undefined>): boolean {
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(query));
}

function visibleGroupMatches(query: string, group: GroupRow): boolean {
  return includes(query, group.name, group.canCreateTask ? "Task target" : null);
}

function createOnlyGroupMatches(query: string, group: GroupRow): boolean {
  return includes(query, group.name, "Task target",
    group.clientWorkstreamId ? "Client workstream target" : "Organisation workstream target");
}

function taskTargetMatches(query: string, target: TaskTargetRow): boolean {
  return includes(query, target.name, target.clientName, "Task target",
    target.kind === "client" ? "Client workstream target" : "Organisation workstream target");
}

/** Search after the server has projected the actor's permission-checked work context. */
export function searchAuthorizedWorkContext(
  source: WorkContextSearchSource,
  rawQuery: string,
): WorkContextSearchSource {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return source;

  const clientsById = new Map(source.clients.map((client) => [client.id, client]));
  const streamsByClient = new Map<string, WorkstreamRow[]>();
  for (const stream of source.clientWorkstreams) {
    const rows = streamsByClient.get(stream.client_id || "") || [];
    rows.push(stream);
    streamsByClient.set(stream.client_id || "", rows);
  }
  const groupsByClientStream = new Map<string, GroupRow[]>();
  const groupsByOrganisationStream = new Map<string, GroupRow[]>();
  for (const group of source.groups) {
    if (!group.canViewGroup) continue;
    if (group.clientWorkstreamId) {
      const rows = groupsByClientStream.get(group.clientWorkstreamId) || [];
      rows.push(group);
      groupsByClientStream.set(group.clientWorkstreamId, rows);
    }
    if (group.organisationWorkstreamId) {
      const rows = groupsByOrganisationStream.get(group.organisationWorkstreamId) || [];
      rows.push(group);
      groupsByOrganisationStream.set(group.organisationWorkstreamId, rows);
    }
  }

  const matchedClients: WorkContextSearchSource["clients"] = [];
  const matchedClientStreams: WorkContextSearchSource["clientWorkstreams"] = [];
  const directClientStreamIds = new Set<string>();
  const matchedGroupIds = new Set<string>();
  const clientIds = new Set([...clientsById.keys(), ...streamsByClient.keys()]);
  for (const clientId of clientIds) {
    const client = clientsById.get(clientId);
    const streams = streamsByClient.get(clientId) || [];
    const clientLabel = client?.name || streams.find((stream) => stream.client_name)?.client_name || "Client context";
    const clientMatches = includes(query, clientLabel);
    let hasDescendantMatch = false;
    for (const stream of streams) {
      const visibleGroups = groupsByClientStream.get(stream.id) || [];
      const streamMatches = clientMatches || includes(query, stream.name);
      if (clientMatches || includes(query, stream.name)) directClientStreamIds.add(stream.id);
      const matchingGroups = streamMatches
        ? visibleGroups
        : visibleGroups.filter((group) => visibleGroupMatches(query, group));
      if (!streamMatches && matchingGroups.length === 0) continue;
      matchedClientStreams.push(stream);
      for (const group of matchingGroups) matchedGroupIds.add(group.id);
      hasDescendantMatch = true;
    }
    if (client && (clientMatches || hasDescendantMatch)) matchedClients.push(client);
  }

  const matchedOrganisationStreams: WorkContextSearchSource["organisationWorkstreams"] = [];
  const directOrganisationStreamIds = new Set<string>();
  for (const stream of source.organisationWorkstreams) {
    const visibleGroups = groupsByOrganisationStream.get(stream.id) || [];
    const streamMatches = includes(query, stream.name);
    if (streamMatches) directOrganisationStreamIds.add(stream.id);
    const matchingGroups = streamMatches
      ? visibleGroups
      : visibleGroups.filter((group) => visibleGroupMatches(query, group));
    if (!streamMatches && matchingGroups.length === 0) continue;
    matchedOrganisationStreams.push(stream);
    for (const group of matchingGroups) matchedGroupIds.add(group.id);
  }

  const visibleClientStreamIds = new Set(source.clientWorkstreams.map((stream) => stream.id));
  const visibleOrganisationStreamIds = new Set(source.organisationWorkstreams.map((stream) => stream.id));
  for (const group of source.groups) {
    if (!group.canViewGroup) continue;
    const hasVisibleParent = group.clientWorkstreamId
      ? visibleClientStreamIds.has(group.clientWorkstreamId)
      : group.organisationWorkstreamId
        ? visibleOrganisationStreamIds.has(group.organisationWorkstreamId)
        : false;
    if (!hasVisibleParent && visibleGroupMatches(query, group)) matchedGroupIds.add(group.id);
  }

  for (const group of source.groups) {
    if (group.canViewGroup || !group.canCreateTask) continue;
    if (createOnlyGroupMatches(query, group) ||
        (group.clientWorkstreamId !== null && directClientStreamIds.has(group.clientWorkstreamId)) ||
        (group.organisationWorkstreamId !== null && directOrganisationStreamIds.has(group.organisationWorkstreamId))) {
      matchedGroupIds.add(group.id);
    }
  }

  const workstreamTargets = source.taskCreationTargets.filter((target) =>
    !target.requiredGroupId && taskTargetMatches(query, target));
  const targetKeys = new Set(workstreamTargets.map((target) => `${target.kind}:${target.id}`));
  const retainedGroupIds = new Set(source.groups.filter((group) => matchedGroupIds.has(group.id)).map((group) => group.id));
  return {
    clients: matchedClients,
    clientWorkstreams: matchedClientStreams,
    organisationWorkstreams: matchedOrganisationStreams,
    taskCreationTargets: source.taskCreationTargets.filter((target) => target.requiredGroupId
      ? retainedGroupIds.has(target.requiredGroupId)
      : targetKeys.has(`${target.kind}:${target.id}`)),
    groups: source.groups.filter((group) => matchedGroupIds.has(group.id)),
  };
}
