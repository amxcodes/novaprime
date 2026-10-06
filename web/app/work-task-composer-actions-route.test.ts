import { describe, expect, it } from "bun:test";
import { createWorkTaskComposerSubmitAction } from "./work-task-composer-actions-route.ts";
import type { TaskCreateInput } from "../src/features/work/task-composer/contracts.ts";

const payload: TaskCreateInput = {
  title: "Prepare report",
  clientWorkstreamId: "client/1",
  workGroupId: "group/1",
  taskCatalogEntryId: "catalog/1",
  taskCatalogRevision: 3,
  description: null,
  priority: "high",
  dueDate: "2026-10-10",
  correctionOfTaskId: "task/original",
  correctionReason: "Fix missing section",
  assignToSelf: true,
};

function harness(options: {
  connected?: boolean;
  current?: boolean;
  permitted?: boolean;
  submissionStatus?: string;
  runError?: unknown;
} = {}) {
  const events: unknown[][] = [];
  const target = { isConnected: options.connected !== false } as unknown as Element;
  const lifetime = { page: 12 };
  const createdTask: {
    assignmentId?: string;
    billingClass: string;
    billingPolicySource: string;
    billingPolicyRevision: number;
  } = {
    assignmentId: "assignment/1",
    billingClass: "billable",
    billingPolicySource: "client_workstream_task_definition",
    billingPolicyRevision: 8,
  };
  const action = createWorkTaskComposerSubmitAction({
    target,
    lifetime,
    isCurrentPageRequest: (value) => {
      events.push(["current", value]);
      return options.current !== false;
    },
    canCreateTask: () => {
      events.push(["permission"]);
      return options.permitted !== false;
    },
    resolveSubmission: (input) => {
      events.push(["resolve", input]);
      return options.submissionStatus === "ready"
        ? { status: "ready", payload: input }
        : { status: options.submissionStatus || "denied" };
    },
    runCommand: async (source, commandLifetime, work, resource) => {
      events.push(["run", source, commandLifetime, resource]);
      const result = await work();
      events.push(["run-complete"]);
      return result;
    },
    api: async (path, init) => {
      events.push(["api", path, init]);
      if (options.runError) throw options.runError;
      return createdTask;
    },
    requestOptions: (method, body, headers) => {
      events.push(["request-options", method, body, headers]);
      return { method, body: JSON.stringify(body), headers };
    },
    idempotencyHeaders: (value) => {
      events.push(["idempotency", value]);
      return { "idempotency-key": "request-key-1" };
    },
    clearIdempotency: (value) => events.push(["clear-idempotency", value]),
    pageChangedError: () => new Error("page changed"),
    permissionDeniedError: () => new Error("permission denied"),
    billingConfirmation: (task) => {
      events.push(["billing", task]);
      return "NOVA automatically classified this task as Billable · predefined-task rule · policy r8";
    },
    correctionConfirmation: (isCorrection) => {
      events.push(["correction", isCorrection]);
      return isCorrection ? " This is a separate correction work item; the original task remains unchanged." : "";
    },
    setMessage: (message) => events.push(["message", message]),
    refreshWork: () => events.push(["refresh"]),
  });
  return { action, events, target, lifetime, createdTask };
}

describe("Work TaskComposer submit action", () => {
  it("rejects a stale page before checking grants or resolving input", async () => {
    const state = harness({ current: false });
    await expect(state.action(payload)).rejects.toThrow("page changed");
    expect(state.events).toEqual([["current", state.lifetime]]);
  });

  it("rejects a detached composer and denied grants before submission work", async () => {
    const detached = harness({ connected: false });
    await expect(detached.action(payload)).rejects.toThrow("page changed");
    expect(detached.events).toEqual([]);

    const denied = harness({ permitted: false });
    await expect(denied.action(payload)).rejects.toThrow("permission denied");
    expect(denied.events.map(([name]) => name)).toEqual(["current", "permission"]);
  });

  it("rejects a non-ready resolved submission without calling the API", async () => {
    const state = harness({ submissionStatus: "invalid" });
    await expect(state.action(payload)).rejects.toThrow("permission denied");
    expect(state.events.map(([name]) => name)).toEqual(["current", "permission", "resolve"]);
  });

  it("preserves the API payload, idempotency header, feedback, and date-aware refresh", async () => {
    const state = harness({ submissionStatus: "ready" });
    await state.action(payload);

    const apiEvent = state.events.find(([name]) => name === "api");
    expect(apiEvent).toEqual([
      "api",
      "/api/tasks",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "idempotency-key": "request-key-1" },
      },
    ]);
    expect(state.events.find(([name]) => name === "run")).toEqual(["run", state.target, state.lifetime, "Work"]);
    expect(state.events.find(([name]) => name === "request-options")).toEqual([
      "request-options", "POST", payload, { "idempotency-key": "request-key-1" },
    ]);
    expect(state.events.find(([name]) => name === "message")).toEqual([
      "message",
      "Task created and added to your assignments. · NOVA automatically classified this task as Billable · predefined-task rule · policy r8 This is a separate correction work item; the original task remains unchanged.",
    ]);
    expect(state.events.at(-1)).toEqual(["refresh"]);
    expect(state.events.findIndex(([name]) => name === "clear-idempotency"))
      .toBeLessThan(state.events.findIndex(([name]) => name === "message"));
  });

  it("keeps the unassigned and non-correction feedback wording", async () => {
    const state = harness({ submissionStatus: "ready" });
    state.createdTask.assignmentId = undefined;
    await state.action({ ...payload, correctionOfTaskId: null });
    expect(state.events.find(([name]) => name === "message")?.[1]).toBe(
      "Task created without assigning it to you. · NOVA automatically classified this task as Billable · predefined-task rule · policy r8",
    );
    expect(state.events.find(([name]) => name === "correction")).toEqual(["correction", false]);
  });

  it("propagates API failures and does not clear idempotency or show success", async () => {
    const failure = new Error("API unavailable");
    const state = harness({ submissionStatus: "ready", runError: failure });
    await expect(state.action(payload)).rejects.toBe(failure);
    expect(state.events.some(([name]) => name === "clear-idempotency")).toBe(false);
    expect(state.events.some(([name]) => name === "message")).toBe(false);
    expect(state.events.some(([name]) => name === "refresh")).toBe(false);
  });
});
