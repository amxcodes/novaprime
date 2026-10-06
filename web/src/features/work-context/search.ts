import type { WorkContextExplorerProjection } from "./explorer-contracts";

export interface WorkContextSearchSummary {
  clientContexts: number;
  workstreams: number;
  visibleGroups: number;
  taskTargets: number;
}

export function summarizeWorkContextProjection(projection: WorkContextExplorerProjection): WorkContextSearchSummary {
  return {
    clientContexts: projection.clients.length,
    workstreams: projection.clientWorkstreams.length + projection.organisationWorkstreams.length,
    visibleGroups: projection.groups.filter((group) => group.canViewGroup).length,
    taskTargets: projection.workstreamTaskTargets.length +
      projection.groups.filter((group) => !group.canViewGroup && group.canCreateTask).length,
  };
}

export function formatWorkContextSearchSummary(summary: WorkContextSearchSummary): string {
  return `Showing ${summary.clientContexts} client ${summary.clientContexts === 1 ? "context" : "contexts"}, ` +
    `${summary.workstreams} workstream${summary.workstreams === 1 ? "" : "s"}, ` +
    `${summary.visibleGroups} visible group${summary.visibleGroups === 1 ? "" : "s"}, and ` +
    `${summary.taskTargets} eligible task creation target${summary.taskTargets === 1 ? "" : "s"} in this response.`;
}
