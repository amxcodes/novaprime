import { describe, expect, it } from "bun:test";
import { createWorkTimelineCorrectionAction } from "./work-timeline-actions-route.ts";
import type { TimelineGapCorrection } from "../src/features/work/timeline/contracts.ts";

const correction: TimelineGapCorrection = {
  startedAt: "2026-10-02T04:00:00.000Z",
  endedAt: "2026-10-02T05:00:00.000Z",
  assignmentId: "assignment-1",
  reason: "Missed the timer.",
};

function harness(overrides: {
  permitted?: boolean;
  current?: boolean;
  afterWrite?: () => void;
  apiError?: unknown;
  recoveryResult?: boolean;
} = {}) {
  const behavior = {
    permitted: true,
    current: true,
    afterWrite: undefined as (() => void) | undefined,
    apiError: undefined as unknown,
    recoveryResult: false,
    ...overrides,
  };
  const events: unknown[][] = [];
  const target = { id: "work-route" } as unknown as Element;
  const context = { id: "command-1" };
  const action = createWorkTimelineCorrectionAction({
    target,
    canAdjustTimeline: () => {
      events.push(["permission"]);
      return behavior.permitted;
    },
    captureCommandContext: (source) => {
      events.push(["capture", source]);
      return context;
    },
    isCurrentCommand: (value) => {
      events.push(["current", value]);
      return behavior.current;
    },
    api: async (path, options) => {
      events.push(["api", path, options]);
      if (behavior.apiError) throw behavior.apiError;
      behavior.afterWrite?.();
      return {};
    },
    requestOptions: (method, body) => {
      events.push(["request-options", method, body]);
      return { method, body } as RequestInit;
    },
    recoverProtectedCommandFailure: (error, value, feedbackMessage) => {
      events.push(["recover", error, value, feedbackMessage]);
      return behavior.recoveryResult;
    },
    adminCommandUiError: (message) => new Error(message),
    errorText: (error) => `Readable: ${error instanceof Error ? error.message : String(error)}`,
    setMessage: (message) => events.push(["message", message]),
    refreshWork: () => events.push(["refresh"]),
  });
  return { action, behavior, context, events, target };
}

describe("Work timeline correction action", () => {
  it("preserves grant, context capture, and current-command check order", async () => {
    const denied = harness({ permitted: false });
    await expect(denied.action(correction)).rejects.toThrow(
      "Your time-correction access changed. Refresh Work before continuing.",
    );
    expect(denied.events).toEqual([["permission"], ["capture", denied.target]]);

    const stale = harness({ current: false });
    await expect(stale.action(correction)).rejects.toThrow(
      "Your time-correction access changed. Refresh Work before continuing.",
    );
    expect(stale.events.map(([name]) => name)).toEqual(["permission", "capture", "current"]);
    expect(stale.events.find(([name]) => name === "api")).toBeUndefined();
  });

  it("rechecks a grant at submit time and denies it if access was revoked after the timeline rendered", async () => {
    const state = harness({ permitted: true });
    state.behavior.permitted = false;
    await expect(state.action(correction)).rejects.toThrow(
      "Your time-correction access changed. Refresh Work before continuing.",
    );
    expect(state.events.map(([name]) => name)).toEqual(["permission", "capture"]);
    expect(state.events.some(([name]) => name === "api")).toBe(false);
  });

  it("posts the exact projected correction and confirms only while the command remains current", async () => {
    const state = harness();
    await state.action(correction);

    expect(state.events).toEqual([
      ["permission"],
      ["capture", state.target],
      ["current", state.context],
      ["request-options", "POST", correction],
      ["api", "/api/work/timeline-adjustments", { method: "POST", body: correction }],
      ["current", state.context],
      ["message", "Timeline gap corrected and audited."],
      ["refresh"],
    ]);
  });

  it("does not report success or refresh if the page becomes stale after the write", async () => {
    const state = harness({ afterWrite: () => { state.behavior.current = false; } });
    await expect(state.action(correction)).rejects.toThrow(
      "The Work page changed before this correction completed.",
    );
    expect(state.events.some(([name]) => name === "message")).toBe(false);
    expect(state.events.some(([name]) => name === "refresh")).toBe(false);
  });

  it("recovers protected failures with the existing access-change messages", async () => {
    const failure = Object.assign(new Error("PERMISSION_DENIED"), { httpStatus: 403 });
    const state = harness({ apiError: failure, recoveryResult: true });
    await expect(state.action(correction)).rejects.toThrow("Your access changed. Refresh Work before continuing.");
    expect(state.events.find(([name]) => name === "recover")).toEqual([
      "recover",
      failure,
      state.context,
      "Your time-correction access changed. Available actions are being refreshed.",
    ]);
    expect(state.events.some(([name]) => name === "message")).toBe(false);
    expect(state.events.some(([name]) => name === "refresh")).toBe(false);
  });

  it("maps unhandled API errors through the host's existing UI error text", async () => {
    const failure = new Error("REQUEST_FAILED");
    const state = harness({ apiError: failure });
    await expect(state.action(correction)).rejects.toThrow("Readable: REQUEST_FAILED");
    expect(state.events.find(([name]) => name === "recover")).toEqual([
      "recover",
      failure,
      state.context,
      "Your time-correction access changed. Available actions are being refreshed.",
    ]);
    expect(state.events.some(([name]) => name === "refresh")).toBe(false);
  });
});
