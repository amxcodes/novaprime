import { describe, expect, it } from "bun:test";
import {
  projectWorkContextClientDepartmentCreation,
  type WorkContextDepartmentFeatureData,
  type WorkContextDepartmentProjectorDependencies,
} from "./client-department-projection";

type Grant = { permissionKey: string; scope: string; clientId?: string };

function data(grants: Grant[], clientIds = ["client-visible", "client-hidden"]): WorkContextDepartmentFeatureData {
  return {
    actorGrants: { grants },
    workContext: { clients: clientIds.map((id) => ({ id, name: id })) },
  };
}

function dependencies(): WorkContextDepartmentProjectorDependencies {
  return {
    hasPermission(current, permission, target) {
      const grants = (current?.actorGrants as { grants?: Grant[] } | undefined)?.grants || [];
      return grants.some((grant) => grant.permissionKey === permission && (
        grant.scope === "organisation" ||
        (grant.scope === "client" && grant.clientId === target.clientId)
      ));
    },
    runCommand: async () => undefined,
  };
}

describe("Work Context client department create projection", () => {
  it("requires effective department-management access and an explicitly visible client", () => {
    const current = data([
      { permissionKey: "clients.departments.manage", scope: "client", clientId: "client-visible" },
      { permissionKey: "clients.view", scope: "client", clientId: "not-in-read" },
    ], ["client-visible"]);

    const capability = projectWorkContextClientDepartmentCreation(current, dependencies());

    expect(capability.authorizedClientIds).toEqual(["client-visible"]);
  });

  it("honors organization-scoped management only for the visible client rows", () => {
    const capability = projectWorkContextClientDepartmentCreation(data([
      { permissionKey: "clients.departments.manage", scope: "organisation" },
    ]), dependencies());

    expect(capability.authorizedClientIds).toEqual(["client-visible", "client-hidden"]);
  });

  it("fails closed when the context read failed or the actor has no matching grant", () => {
    const noGrant = projectWorkContextClientDepartmentCreation(data([]), dependencies());
    const failedRead = projectWorkContextClientDepartmentCreation({
      actorGrants: { grants: [{ permissionKey: "clients.departments.manage", scope: "organisation" }] },
      workContext: { readError: "PERMISSION_DENIED", clients: [{ id: "client-visible", name: "Visible" }] },
    }, dependencies());

    expect(noGrant.authorizedClientIds).toEqual([]);
    expect(failedRead.authorizedClientIds).toEqual([]);
  });

  it("posts the trimmed name to the exact client path and rechecks the current visible target grant", async () => {
    const current = data([
      { permissionKey: "clients.departments.manage", scope: "client", clientId: "client-visible" },
    ], ["client-visible"]);
    const commands: Array<{
      permission: (latest: WorkContextDepartmentFeatureData | null | undefined) => boolean;
      permissionTarget: { clientId: string };
      method: "POST";
      path: string;
      payload: { name: string };
    }> = [];
    const deps = dependencies();
    deps.runCommand = async (permission, permissionTarget, method, path, payload) => {
      commands.push({ permission, permissionTarget, method, path, payload });
    };
    const capability = projectWorkContextClientDepartmentCreation(current, deps);

    await capability.onCreate("client-visible", "  Product design  ");

    expect(commands.map(({ permissionTarget, method, path, payload }) => ({ permissionTarget, method, path, payload }))).toEqual([{
      permissionTarget: { clientId: "client-visible" },
      method: "POST",
      path: "/api/clients/client-visible/departments",
      payload: { name: "Product design" },
    }]);
    expect(commands[0]!.permission(current)).toBe(true);
    expect(commands[0]!.permission(data([]))).toBe(false);
    expect(commands[0]!.permission(data([
      { permissionKey: "clients.departments.manage", scope: "client", clientId: "client-visible" },
    ], []))).toBe(false);
  });

  it("rejects unknown targets and empty or overlong names before issuing a command", async () => {
    let calls = 0;
    const deps = dependencies();
    deps.runCommand = async () => { calls += 1; };
    const capability = projectWorkContextClientDepartmentCreation(data([
      { permissionKey: "clients.departments.manage", scope: "organisation" },
    ]), deps);

    await expect(capability.onCreate("client-not-visible", "Support")).rejects.toThrow("visible client");
    await expect(capability.onCreate("client-visible", "  ")).rejects.toThrow("department name");
    await expect(capability.onCreate("client-visible", "x".repeat(181))).rejects.toThrow("department name");
    expect(calls).toBe(0);
  });
});
