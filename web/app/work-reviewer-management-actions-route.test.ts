import { describe, expect, it } from "bun:test";
import { createWorkReviewerManagementSaveAction } from "./work-reviewer-management-actions-route.ts";

function harness(options: {
  permitted?: boolean;
  commandStates?: boolean[];
  identityCurrent?: boolean;
  response?: unknown;
  apiError?: unknown;
  recover?: boolean;
} = {}) {
  const target = { isConnected: true } as unknown as Element;
  const context = { identity: "actor-1", page: "work-1" };
  const calls = {
    permission: 0,
    capture: [] as Array<Element | null>,
    commandChecks: 0,
    identityChecks: 0,
    recover: [] as Array<{ error: unknown; context: unknown; message: string }>,
    api: [] as Array<{ path: string; method: string; body: unknown }>,
  };
  const states = [...(options.commandStates ?? [true, true])];
  const save = createWorkReviewerManagementSaveAction({
    target,
    canManageReviewer: () => {
      calls.permission += 1;
      return options.permitted !== false;
    },
    captureCommandContext: (source) => {
      calls.capture.push(source);
      return context;
    },
    isCurrentCommand: (value) => {
      calls.commandChecks += 1;
      expect(value).toBe(context);
      return states.shift() ?? true;
    },
    isCurrentCommandIdentity: (value) => {
      calls.identityChecks += 1;
      expect(value).toBe(context);
      return options.identityCurrent !== false;
    },
    recoverProtectedCommandFailure: (error, value, message) => {
      calls.recover.push({ error, context: value, message });
      return options.recover === true;
    },
    async api(path, requestOptions) {
      calls.api.push({
        path,
        method: requestOptions.method || "GET",
        body: requestOptions.body ? JSON.parse(String(requestOptions.body)) : undefined,
      });
      if ("apiError" in options) throw options.apiError;
      return "response" in options
        ? options.response
        : { assignmentId: decodeURIComponent(path.split("/").at(-2) || "") };
    },
    requestOptions(method, body) {
      return { method, body: JSON.stringify(body) };
    },
  });
  return { save, target, context, calls };
}

describe("Work Reviewer Management save action", () => {
  it("saves only after current permission and context checks with the existing PATCH contract", async () => {
    const state = harness();
    expect(await state.save("assignment/1", "reviewer/2")).toEqual({ status: "saved" });
    expect(state.calls.permission).toBe(1);
    expect(state.calls.capture).toEqual([state.target]);
    expect(state.calls.commandChecks).toBe(2);
    expect(state.calls.api).toEqual([{
      path: "/api/task-assignments/assignment%2F1/reviewer",
      method: "PATCH",
      body: { reviewerPersonId: "reviewer/2" },
    }]);
  });

  it("returns denied without transport when the scoped capability is gone", async () => {
    const state = harness({ permitted: false });
    expect(await state.save("assignment-1", "reviewer-2")).toEqual({
      status: "denied",
      message: "Reviewer management access changed. Refresh Work to check current access.",
    });
    expect(state.calls.permission).toBe(1);
    expect(state.calls.capture).toEqual([state.target]);
    expect(state.calls.commandChecks).toBe(0);
    expect(state.calls.api).toEqual([]);
  });

  it("returns stale before sending when the page command context is no longer current", async () => {
    const state = harness({ commandStates: [false] });
    expect(await state.save("assignment-1", "reviewer-2")).toEqual({
      status: "stale",
      message: "The Work page changed before this reviewer update could start.",
    });
    expect(state.calls.commandChecks).toBe(1);
    expect(state.calls.api).toEqual([]);
  });

  it("returns stale when the page changes while the save request is in flight", async () => {
    const state = harness({ commandStates: [true, false] });
    expect(await state.save("assignment-1", "reviewer-2")).toEqual({
      status: "stale",
      message: "The Work page changed before this reviewer update could be confirmed.",
    });
    expect(state.calls.api).toHaveLength(1);
    expect(state.calls.commandChecks).toBe(2);
  });

  it("returns stale when identity changes during a failed request", async () => {
    const state = harness({ apiError: new Error("network"), identityCurrent: false });
    expect(await state.save("assignment-1", "reviewer-2")).toEqual({
      status: "stale",
      message: "Your session changed before this reviewer update could be confirmed.",
    });
    expect(state.calls.identityChecks).toBe(1);
    expect(state.calls.recover).toEqual([]);
  });

  it("maps protected access changes to denied and requests the existing recovery feedback", async () => {
    const forbidden = Object.assign(new Error("forbidden"), { httpStatus: 403 });
    const state = harness({ apiError: forbidden, recover: true });
    expect(await state.save("assignment-1", "reviewer-2")).toEqual({
      status: "denied",
      message: "Reviewer management access changed. Refresh Work to check current access.",
    });
    expect(state.calls.recover).toEqual([{
      error: forbidden,
      context: state.context,
      message: "Reviewer management access changed. Available controls are being refreshed.",
    }]);
  });

  it("reports a malformed success response without claiming the reviewer was changed", async () => {
    for (const response of [null, {}, { assignmentId: "another-assignment" }]) {
      const state = harness({ response });
      expect(await state.save("assignment-1", "reviewer-2")).toEqual({
        status: "error",
        message: "NOVA could not confirm that the reviewer changed. Refresh this assignment before trying again.",
      });
    }
  });

  it("propagates ordinary API errors when identity and page context remain current", async () => {
    const failure = Object.assign(new Error("service unavailable"), { httpStatus: 503 });
    const state = harness({ apiError: failure });
    await expect(state.save("assignment-1", "reviewer-2")).rejects.toBe(failure);
    expect(state.calls.identityChecks).toBe(1);
    expect(state.calls.commandChecks).toBe(2);
    expect(state.calls.recover).toHaveLength(1);
  });
});
