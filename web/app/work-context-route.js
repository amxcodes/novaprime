const deniedReadErrors = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);

/**
 * Project the authorized `/api/work-context` response into the explorer's
 * small presentation contract. The host continues to own fetching and grants.
 */
export function projectWorkContextExplorerRead(result, issue) {
  const workContext = isRecord(result) ? result : {};
  if (!isRecord(result)) {
    return {
      status: "error",
      message: issue?.message || "Work context could not be read. Refresh the page to try again.",
    };
  }

  if (issue) {
    return {
      status: deniedReadErrors.has(workContext.readError) ? "denied" : "error",
      message: issue.message,
    };
  }

  const clientWorkstreamIds = new Set(
    (Array.isArray(workContext.clientWorkstreams) ? workContext.clientWorkstreams : [])
      .filter(isRecord)
      .map((workstream) => workstream.id)
      .filter((id) => typeof id === "string"),
  );
  const organisationWorkstreamIds = new Set(
    (Array.isArray(workContext.organisationWorkstreams) ? workContext.organisationWorkstreams : [])
      .filter(isRecord)
      .map((workstream) => workstream.id)
      .filter((id) => typeof id === "string"),
  );
  const seenTaskTargets = new Set();
  const workstreamTaskTargets = (Array.isArray(workContext.taskCreationTargets) ? workContext.taskCreationTargets : [])
    .filter(isRecord)
    .flatMap((target) => {
      if ((target.requiredGroupId !== undefined && target.requiredGroupId !== null) ||
          typeof target.id !== "string" || !target.id.trim() ||
          typeof target.name !== "string" || !target.name.trim() ||
          (target.kind !== "client" && target.kind !== "organisation")) return [];
      const targetKey = `${target.kind}:${target.id}`;
      if (seenTaskTargets.has(targetKey)) return [];
      if (target.kind === "client" && clientWorkstreamIds.has(target.id)) return [];
      if (target.kind === "organisation" && organisationWorkstreamIds.has(target.id)) return [];
      seenTaskTargets.add(targetKey);
      return [{
        id: target.id,
        name: target.name,
        kind: target.kind,
        ...(target.kind === "client" && typeof target.clientName === "string" && target.clientName.trim()
          ? { clientName: target.clientName }
          : {}),
      }];
    });

  return {
    status: "ready",
    projection: {
      clients: Array.isArray(workContext.clients)
        ? workContext.clients.map((client) => ({ id: client.id, name: client.name }))
        : [],
      clientWorkstreams: Array.isArray(workContext.clientWorkstreams)
        ? workContext.clientWorkstreams.map((item) => ({
          id: item.id,
          clientId: item.client_id,
          clientName: item.client_name,
          name: item.name,
        }))
        : [],
      organisationWorkstreams: Array.isArray(workContext.organisationWorkstreams)
        ? workContext.organisationWorkstreams.map((item) => ({ id: item.id, name: item.name }))
        : [],
      workstreamTaskTargets,
      groups: Array.isArray(workContext.groups)
        ? workContext.groups.map((group) => ({
          id: group.id,
          name: group.name,
          clientWorkstreamId: group.clientWorkstreamId,
          organisationWorkstreamId: group.organisationWorkstreamId,
          canViewGroup: group.canViewGroup === true,
          canCreateTask: group.canCreateTask === true,
        }))
        : [],
    },
  };
}

/**
 * Compose the feature-owned Work Context explorer from an already-authorized
 * host read. Authenticated transport, grant planning, page lifetime, and the
 * guarded department command remain dependencies owned by the route host.
 */
export function mountWorkContextRoute({
  target,
  result,
  ui,
  uiLoadError,
  actorGrants,
  projectDepartmentCreation,
  hasPermission,
  runCommand,
  getReadIssue,
  mountIsland,
  searchWorkContext,
  showFeatureMessage,
} = {}) {
  if (typeof getReadIssue !== "function") throw new TypeError("getReadIssue must be a function");
  if (typeof mountIsland !== "function") throw new TypeError("mountIsland must be a function");
  if (typeof searchWorkContext !== "function") throw new TypeError("searchWorkContext must be a function");
  if (typeof showFeatureMessage !== "function") throw new TypeError("showFeatureMessage must be a function");

  const issue = getReadIssue(result, "work context");
  const readState = projectWorkContextExplorerRead(result, issue);
  const Component = ui?.WorkContextExplorer;
  if (Component && typeof projectDepartmentCreation === "function" && typeof hasPermission === "function" && typeof runCommand === "function") {
    const departmentCapability = projectDepartmentCreation({ actorGrants, workContext: result }, {
      hasPermission: (current, permission, targetPermission) =>
        hasPermission(current?.actorGrants, permission, targetPermission),
      runCommand,
    });

    mountIsland(target, Component, {
      readState,
      onSearch: async (query) => {
        const searchResult = await searchWorkContext(query);
        return projectWorkContextExplorerRead(searchResult, getReadIssue(searchResult, "work context search"));
      },
      departmentCreation: departmentCapability.authorizedClientIds.length
        ? departmentCapability
        : undefined,
    });
    return { status: "mounted", readState };
  }

  showFeatureMessage(target, "Work context is unavailable",
    uiLoadError ? "The work context view could not load. Refresh the page to try again." : "The work context view is unavailable.",
  );
  return { status: "unavailable", readState };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
