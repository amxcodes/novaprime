import { describe, expect, it } from "bun:test";
import { createWorkContextDepartmentCommandAction } from "./work-context-actions-route.ts";
import type { WorkContextDepartmentFeatureData } from "../src/features/work-context/client-department-projection.ts";

const permissionTarget = { clientId: "client-1" };
const path = "/api/clients/client-1/departments";
const payload = { name: "People Operations" };

function harness(options: {
  current?: boolean;
  permitted?: boolean;
  apiError?: unknown;
} = {}) {
  const behavior = { current: true, permitted: true, apiError: undefined as unknown, ...options };
  const events: unknown[][] = [];
  const target = { id: "work-context-slot" } as unknown as Element;
  const lifetime = { page: "work-context" };
  const permissionData: WorkContextDepartmentFeatureData = {
    actorGrants: { id: "current-grants" },
    workContext: { clients: [{ id: "client-1", name: "Northwind" }] },
  };
  const denied = new Error("PERMISSION_DENIED");
  const command = createWorkContextDepartmentCommandAction({
    target,
    lifetime,
    getPermissionData: () => {
      events.push(["permission-data"]);
      return permissionData;
    },
    runWorkSetupCommand: async (source, commandLifetime, work, resource) => {
      events.push(["command", source, commandLifetime, resource]);
      if (!behavior.current) throw new Error("The Work page changed before this action could start.");
      return work();
    },
    api: async (requestPath, options) => {
      events.push(["api", requestPath, options]);
      if (behavior.apiError) throw behavior.apiError;
      return { id: "department-1" };
    },
    requestOptions: (method, body) => {
      events.push(["request-options", method, body]);
      return { method, body } as RequestInit;
    },
    permissionDeniedError: () => denied,
    setMessage: (message) => events.push(["message", message]),
  });
  const permission = (latest: WorkContextDepartmentFeatureData | null | undefined) => {
    events.push(["permission", latest]);
    return behavior.permitted && latest?.actorGrants === permissionData.actorGrants &&
      latest.workContext === permissionData.workContext;
  };
  return { behavior, command, denied, events, lifetime, permission, permissionData, target };
}

function runDepartmentCommand(state: ReturnType<typeof harness>) {
  return state.command(
    state.permission,
    permissionTarget,
    "POST",
    path,
    payload,
    "Client department created.",
  );
}

describe("Work Context department command action", () => {
  it("keeps the shared page-lifetime guard ahead of permission and transport", async () => {
    const state = harness({ current: false });
    await expect(runDepartmentCommand(state)).rejects.toThrow("Work page changed");
    expect(state.events).toEqual([["command", state.target, state.lifetime, "Work"]]);
  });

  it("rechecks current actor grants and rejects without a write when access changed", async () => {
    const state = harness({ permitted: false });
    await expect(runDepartmentCommand(state)).rejects.toBe(state.denied);
    expect(state.events.map(([name]) => name)).toEqual(["command", "permission-data", "permission"]);
    expect(state.events.some(([name]) => name === "api")).toBe(false);
    expect(state.events.some(([name]) => name === "message")).toBe(false);
  });

  it("preserves the client-scoped POST, payload, success feedback, and result pass-through", async () => {
    const state = harness();
    const result = await runDepartmentCommand(state);
    expect(result).toEqual({ id: "department-1" });
    expect(state.events).toEqual([
      ["command", state.target, state.lifetime, "Work"],
      ["permission-data"],
      ["permission", state.permissionData],
      ["request-options", "POST", payload],
      ["api", path, { method: "POST", body: payload }],
      ["message", "Client department created."],
    ]);
  });

  it("propagates request errors without success feedback", async () => {
    const failure = new Error("REQUEST_FAILED");
    const state = harness({ apiError: failure });
    await expect(runDepartmentCommand(state)).rejects.toBe(failure);
    expect(state.events.some(([name]) => name === "message")).toBe(false);
  });
});
