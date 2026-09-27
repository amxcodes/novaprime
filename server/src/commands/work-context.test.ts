import { describe, expect, test } from "bun:test";
import { taskCorrectionInput, validTaskDueDate } from "./work-context.js";

const originalTaskId = "9f7fda96-7352-4e96-9ce0-71c0de51f761";

describe("correction-task input", () => {
  test("keeps correction purpose separate from billing classification", () => {
    expect(taskCorrectionInput({ title: "Task" })).toEqual({
      correctionOfTaskId: null,
      correctionReason: null,
    });
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "Fix the approved deliverable.",
    })).toEqual({
      correctionOfTaskId: originalTaskId,
      correctionReason: "Fix the approved deliverable.",
    });
  });

  test("rejects malformed source IDs", () => {
    expect(taskCorrectionInput({ correctionOfTaskId: "not-a-uuid", correctionReason: "Fix it" })).toBeUndefined();
  });

  test("requires one bounded reason exactly when a source task is selected", () => {
    expect(taskCorrectionInput({ correctionOfTaskId: originalTaskId })).toBeUndefined();
    expect(taskCorrectionInput({ correctionReason: "Not linked" })).toBeUndefined();
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "   ",
    })).toBeUndefined();
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "x".repeat(2001),
    })).toBeUndefined();
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "  Adjusted scope.  ",
    })?.correctionReason).toBe("Adjusted scope.");
  });
});

describe("task due dates", () => {
  test("accepts real local calendar dates and rejects impossible or zero-year dates", () => {
    expect(validTaskDueDate("2024-02-29")).toBe(true);
    expect(validTaskDueDate("2025-02-29")).toBe(false);
    expect(validTaskDueDate("2026-04-31")).toBe(false);
    expect(validTaskDueDate("0000-01-01")).toBe(false);
    expect(validTaskDueDate("2026-09-24T00:00:00Z")).toBe(false);
  });
});
