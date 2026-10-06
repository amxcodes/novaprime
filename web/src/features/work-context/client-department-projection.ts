import type { WorkContextClientDepartmentCreation } from "./explorer-contracts";

export interface WorkContextDepartmentFeatureData {
  actorGrants?: unknown;
  workContext?: {
    readError?: string;
    clients?: readonly { id?: string | null; name?: string | null }[];
  };
}

type PermissionTarget = { clientId: string };
type PermissionCheck = (
  data: WorkContextDepartmentFeatureData | null | undefined,
  permission: "clients.departments.manage",
  target: PermissionTarget,
) => boolean;
type RunCommand = (
  permission: (latest: WorkContextDepartmentFeatureData | null | undefined) => boolean,
  permissionTarget: PermissionTarget,
  method: "POST",
  path: string,
  payload: { name: string },
  successMessage: string,
) => Promise<unknown>;

export interface WorkContextDepartmentProjectorDependencies {
  hasPermission: PermissionCheck;
  runCommand: RunCommand;
}

function visibleClientIds(data: WorkContextDepartmentFeatureData | null | undefined): string[] {
  if (data?.workContext?.readError || !Array.isArray(data?.workContext?.clients)) return [];
  return [...new Set(data.workContext.clients.flatMap((client) =>
    typeof client?.id === "string" && client.id.trim() ? [client.id.trim()] : []))];
}

/**
 * Projects only client department creation on clients already explicitly
 * returned by the authorized work-context read. The department API remains
 * the final authorization boundary and no department-list capability is
 * inferred here.
 */
export function projectWorkContextClientDepartmentCreation(
  data: WorkContextDepartmentFeatureData,
  dependencies: WorkContextDepartmentProjectorDependencies,
): WorkContextClientDepartmentCreation {
  const { hasPermission, runCommand } = dependencies;
  const authorizedClientIds = visibleClientIds(data).filter((clientId) =>
    hasPermission(data, "clients.departments.manage", { clientId }));
  const authorizedClientSet = new Set(authorizedClientIds);

  return {
    authorizedClientIds,
    onCreate: (clientId, rawName) => {
      const name = rawName.trim();
      if (!authorizedClientSet.has(clientId)) {
        return Promise.reject(new Error("Choose a visible client with department-management access."));
      }
      if (!name || name.length > 180) {
        return Promise.reject(new Error("Enter a department name up to 180 characters."));
      }
      const permissionTarget = { clientId };
      return runCommand(
        (latest) => visibleClientIds(latest).includes(clientId) &&
          hasPermission(latest, "clients.departments.manage", permissionTarget),
        permissionTarget,
        "POST",
        `/api/clients/${encodeURIComponent(clientId)}/departments`,
        { name },
        "Client department created.",
      ).then(() => undefined);
    },
  };
}
