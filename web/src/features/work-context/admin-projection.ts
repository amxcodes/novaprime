import type {
  WorkContextCreationClientOption,
  WorkContextCreationProps,
  WorkContextCreationWorkstreamOption,
} from "./contracts";

export interface AdminWorkContextFeatureData {
  actorGrants?: unknown;
  workContext?: {
    readError?: string;
    clients?: readonly { id: string; name: string }[];
    clientWorkstreams?: readonly { id: string; clientId: string; clientName?: string; name: string }[];
    organisationWorkstreams?: readonly { id: string; name: string }[];
  };
}

type PermissionTarget = Record<string, string>;
type AdminPermissionCheck = (data: AdminWorkContextFeatureData | null | undefined, permission: string, target?: PermissionTarget) => boolean;
type AdminGrantCheck = (grants: unknown, permissions: readonly string[], scopes: readonly string[]) => boolean;
type RunAdminCommand = (
  permission: (latest: AdminWorkContextFeatureData | null | undefined) => boolean,
  permissionTarget: PermissionTarget,
  method: "POST",
  path: string,
  payload: Record<string, string>,
  successMessage: string,
) => Promise<unknown>;

export interface AdminWorkContextProjectorDependencies {
  hasPermission: AdminPermissionCheck;
  hasAnyPermission: AdminGrantCheck;
  readIssue(result: unknown, resource: string): { kind: string; message: string } | undefined;
  runCommand: RunAdminCommand;
}

function clientCreateOptions(
  data: AdminWorkContextFeatureData | null | undefined,
  hasPermission: AdminPermissionCheck,
): WorkContextCreationClientOption[] {
  const options = new Map<string, WorkContextCreationClientOption>();
  for (const client of data?.workContext?.clients || []) {
    if (client.id && client.name?.trim() && hasPermission(data, "workstreams.create", { clientId: client.id })) {
      options.set(client.id, { id: client.id, name: client.name.trim() });
    }
  }
  // A visible workstream carries authorized client context even when the
  // separate client directory projection is unavailable to this actor.
  for (const workstream of data?.workContext?.clientWorkstreams || []) {
    if (workstream.clientId && hasPermission(data, "workstreams.create", { clientId: workstream.clientId }) &&
        !options.has(workstream.clientId)) {
      options.set(workstream.clientId, { id: workstream.clientId, name: workstream.clientName?.trim() || "Client" });
    }
  }
  return [...options.values()];
}

function groupCreateOptions(
  data: AdminWorkContextFeatureData | null | undefined,
  hasPermission: AdminPermissionCheck,
): WorkContextCreationWorkstreamOption[] {
  const options: WorkContextCreationWorkstreamOption[] = [];
  for (const workstream of data?.workContext?.clientWorkstreams || []) {
    if (workstream.id && workstream.name?.trim() && hasPermission(data, "groups.create", { clientWorkstreamId: workstream.id })) {
      options.push({ id: workstream.id, name: workstream.name.trim(), kind: "client" });
    }
  }
  for (const workstream of data?.workContext?.organisationWorkstreams || []) {
    if (workstream.id && workstream.name?.trim() && hasPermission(data, "groups.create")) {
      options.push({ id: workstream.id, name: workstream.name.trim(), kind: "organisation" });
    }
  }
  return options;
}

export function projectAdminWorkContextCreation(
  data: AdminWorkContextFeatureData,
  dependencies: AdminWorkContextProjectorDependencies,
): Omit<WorkContextCreationProps, "onSearchClients" | "onSearchGroupWorkstreams"> {
  const { hasPermission, hasAnyPermission, readIssue, runCommand } = dependencies;
  const issue = readIssue(data.workContext, "work context");
  const denied = ["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"].includes(data.workContext?.readError || "");
  const readState: WorkContextCreationProps["readState"] = issue
    ? { status: denied ? "unavailable" : "error", message: issue.message }
    : { status: "ready" };
  const clientOptions = clientCreateOptions(data, hasPermission);
  const groupWorkstreamOptions = groupCreateOptions(data, hasPermission);

  return {
    readState,
    canCreateClient: hasPermission(data, "clients.create"),
    canCreateClientWorkstream: hasAnyPermission(data.actorGrants, ["workstreams.create"], ["client"]),
    canCreateOrganisationWorkstream: hasPermission(data, "workstreams.create"),
    canCreateGroup: hasAnyPermission(data.actorGrants, ["groups.create"], ["organisation", "client_workstream"]),
    clientOptions,
    groupWorkstreamOptions,
    onCreateClient: (name) => runCommand(
      (latest) => hasPermission(latest, "clients.create"), {},
      "POST", "/api/clients", { name }, "Client created.",
    ).then(() => undefined),
    onCreateClientWorkstream: ({ name, clientId }) => runCommand(
      (latest) => hasPermission(latest, "workstreams.create", { clientId }) &&
        clientCreateOptions(latest, hasPermission).some((option) => option.id === clientId),
      { clientId }, "POST", "/api/workstreams/client", { name, clientId }, "Client workstream created.",
    ).then(() => undefined),
    onCreateOrganisationWorkstream: (name) => runCommand(
      (latest) => hasPermission(latest, "workstreams.create"), {},
      "POST", "/api/workstreams/organisation", { name }, "Organisation workstream created.",
    ).then(() => undefined),
    onCreateGroup: ({ name, workstreamId, workstreamKind }) => {
      const permissionTarget: PermissionTarget = workstreamKind === "client"
        ? { clientWorkstreamId: workstreamId }
        : {};
      const payload: Record<string, string> = workstreamKind === "client"
        ? { name, clientWorkstreamId: workstreamId }
        : { name, organisationWorkstreamId: workstreamId };
      return runCommand(
        (latest) => hasPermission(latest, "groups.create", permissionTarget) &&
          groupCreateOptions(latest, hasPermission).some((option) => option.id === workstreamId && option.kind === workstreamKind),
        permissionTarget, "POST", "/api/work-groups", payload, "Work group created.",
      ).then(() => undefined);
    },
  };
}
