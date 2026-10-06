import { describe, expect, it } from "bun:test";
import {
  projectAdminWorkContextCreation,
  type AdminWorkContextFeatureData,
  type AdminWorkContextProjectorDependencies,
} from "./admin-projection";

type Grant = { permissionKey: string; scope: string; clientId?: string; clientWorkstreamId?: string };

function featureData(grants: Grant[] = []): AdminWorkContextFeatureData {
  return {
    actorGrants: { grants },
    workContext: {
      clients: [
        { id: "client-allowed", name: "Northstar" },
        { id: "client-hidden", name: "Restricted" },
      ],
      clientWorkstreams: [
        { id: "stream-allowed", clientId: "client-allowed", clientName: "Northstar", name: "Delivery" },
        { id: "stream-hidden", clientId: "client-hidden", clientName: "Restricted", name: "Private" },
      ],
      organisationWorkstreams: [{ id: "org-stream", name: "Operations" }],
    },
  };
}

function dependencies(): AdminWorkContextProjectorDependencies {
  return {
    hasPermission(data, permission, target = {}) {
      const grants = (data?.actorGrants as { grants?: Grant[] } | undefined)?.grants || [];
      return grants.some((grant) => grant.permissionKey === permission && (
        grant.scope === "organisation" ||
        (grant.scope === "client" && target.clientId === grant.clientId) ||
        (grant.scope === "client_workstream" && target.clientWorkstreamId === grant.clientWorkstreamId)
      ));
    },
    hasAnyPermission(actorGrants, permissions, scopes) {
      const grants = (actorGrants as { grants?: Grant[] } | undefined)?.grants || [];
      return grants.some((grant) => permissions.includes(grant.permissionKey) && scopes.includes(grant.scope));
    },
    readIssue(result) {
      return (result as { readError?: string } | undefined)?.readError
        ? { kind: "unavailable", message: "Work context choices could not be loaded." }
        : undefined;
    },
    runCommand: async () => undefined,
  };
}

describe("Admin work-context projection", () => {
  it("projects only creation forms and targets backed by effective grants", () => {
    const data = featureData([
      { permissionKey: "clients.create", scope: "organisation" },
      { permissionKey: "workstreams.create", scope: "client", clientId: "client-allowed" },
      { permissionKey: "groups.create", scope: "client_workstream", clientWorkstreamId: "stream-allowed" },
    ]);

    const props = projectAdminWorkContextCreation(data, dependencies());

    expect(props).toMatchObject({
      canCreateClient: true,
      canCreateClientWorkstream: true,
      canCreateOrganisationWorkstream: false,
      canCreateGroup: true,
    });
    expect(props.clientOptions).toEqual([{ id: "client-allowed", name: "Northstar" }]);
    expect(props.groupWorkstreamOptions).toEqual([{ id: "stream-allowed", name: "Delivery", kind: "client" }]);
  });

  it("preserves exact existing create endpoints and rechecks the selected scope against current data", async () => {
    const data = featureData([
      { permissionKey: "clients.create", scope: "organisation" },
      { permissionKey: "workstreams.create", scope: "client", clientId: "client-allowed" },
      { permissionKey: "workstreams.create", scope: "organisation" },
      { permissionKey: "groups.create", scope: "client_workstream", clientWorkstreamId: "stream-allowed" },
    ]);
    const commands: Array<{
      permission: (latest: AdminWorkContextFeatureData | null | undefined) => boolean;
      permissionTarget: Record<string, string>;
      method: "POST";
      path: string;
      payload: Record<string, string>;
    }> = [];
    const deps = dependencies();
    deps.runCommand = async (permission, permissionTarget, method, path, payload) => {
      commands.push({ permission, permissionTarget, method, path, payload });
    };
    const props = projectAdminWorkContextCreation(data, deps);

    await props.onCreateClient("Northstar");
    await props.onCreateClientWorkstream({ name: "  Delivery  ", clientId: "client-allowed" });
    await props.onCreateOrganisationWorkstream("Operations");
    await props.onCreateGroup({ name: "  Platform  ", workstreamId: "stream-allowed", workstreamKind: "client" });

    expect(commands.map(({ method, path, payload }) => ({ method, path, payload }))).toEqual([
      { method: "POST", path: "/api/clients", payload: { name: "Northstar" } },
      { method: "POST", path: "/api/workstreams/client", payload: { name: "  Delivery  ", clientId: "client-allowed" } },
      { method: "POST", path: "/api/workstreams/organisation", payload: { name: "Operations" } },
      { method: "POST", path: "/api/work-groups", payload: { name: "  Platform  ", clientWorkstreamId: "stream-allowed" } },
    ]);
    expect(commands[0]!.permissionTarget).toEqual({});
    expect(commands[0]!.permission(data)).toBe(true);
    expect(commands[0]!.permission(featureData([]))).toBe(false);
    expect(commands[1]!.permissionTarget).toEqual({ clientId: "client-allowed" });
    expect(commands[1]!.permission(data)).toBe(true);
    expect(commands[1]!.permission(featureData([]))).toBe(false);
    expect(commands[2]!.permissionTarget).toEqual({});
    expect(commands[2]!.permission(data)).toBe(true);
    expect(commands[2]!.permission(featureData([]))).toBe(false);
    expect(commands[3]!.permissionTarget).toEqual({ clientWorkstreamId: "stream-allowed" });
    expect(commands[3]!.permission(data)).toBe(true);
    expect(commands[3]!.permission(featureData([]))).toBe(false);
  });

  it("keeps independent create grants visible while parent selectors report their own unavailable state", () => {
    const data = featureData([{ permissionKey: "workstreams.create", scope: "organisation" }]);
    data.workContext!.readError = "REQUEST_FAILED";

    const props = projectAdminWorkContextCreation(data, dependencies());

    expect(props.readState).toEqual({ status: "error", message: "Work context choices could not be loaded." });
    expect(props.canCreateOrganisationWorkstream).toBe(true);
    expect(props.canCreateClientWorkstream).toBe(false);
    expect(props.canCreateGroup).toBe(false);
  });
});
