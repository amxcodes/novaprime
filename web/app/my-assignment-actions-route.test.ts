import { describe, expect, it } from "bun:test";
import { createMyAssignmentActionsRoute } from "./my-assignment-actions-route.ts";
import type { WorkAssignment } from "../src/features/work/contracts.ts";
import type { FormEvent } from "react";

const assignment: WorkAssignment = {
  assignmentId: "assignment/1",
  taskId: "task/1",
  title: "Prepare report",
  canViewTask: true,
  status: "in_progress",
  dueDate: "2026-10-10",
  dueDateRevision: 4,
  canEditDueDate: true,
  canStart: true,
  canSubmit: true,
  canRequestReviewer: true,
  canRequestHandover: true,
  hasPendingReviewerRequest: false,
  hasPendingHandoverRequest: false,
};

function harness(options: { current?: boolean } = {}) {
  const source = { disabled: false } as unknown as HTMLButtonElement;
  const dueForm = { key: "due" } as unknown as HTMLFormElement;
  const reviewerForm = { key: "reviewer" } as unknown as HTMLFormElement;
  const handoverForm = { key: "handover" } as unknown as HTMLFormElement;
  const forms = new Map<HTMLFormElement, Record<string, FormDataEntryValue>>([
    [dueForm, { dueDate: " 2026-11-02 " }],
    [reviewerForm, { reviewerPersonId: "person-reviewer", reason: "Needs review" }],
    [handoverForm, { targetPersonId: "person-target", reason: "Moving teams" }],
  ]);
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const messages: string[] = [];
  const refreshes: number[] = [];
  const submitted: FormEvent<HTMLFormElement>[] = [];
  const pending: Array<Promise<unknown>> = [];
  const context = { id: "command-1" };
  const route = createMyAssignmentActionsRoute({
    async api(path, requestOptions) {
      const request = requestOptions as RequestInit & { body?: unknown };
      requests.push({ path, method: request.method || "GET", body: request.body });
      return { changed: true, notifiedAssigneeCount: 2 };
    },
    requestOptions(method, body) {
      return { method, body } as RequestInit;
    },
    runActionButton(_button, work) {
      const run = Promise.resolve(work(context));
      pending.push(run);
      return run;
    },
    withSubmit(event, work) {
      submitted.push(event);
      const run = Promise.resolve(work(context));
      pending.push(run);
      return run;
    },
    isCurrentCommand: () => options.current !== false,
    formValues: (form) => forms.get(form) || {},
    setMessage: (message) => messages.push(message),
    refreshWork: () => refreshes.push(refreshes.length + 1),
  });
  const event = (form: HTMLFormElement) => ({
    currentTarget: form,
    preventDefault() {},
  } as unknown as FormEvent<HTMLFormElement>);
  const flush = async () => { await Promise.all(pending); };
  return { route, source, dueForm, reviewerForm, handoverForm, requests, messages, refreshes, submitted, event, flush };
}

describe("My Assignments action route", () => {
  it("preserves existing endpoints, payloads, feedback, and host command wrappers", async () => {
    const state = harness();
    state.route.onStart(assignment, state.source);
    state.route.onSubmit(assignment, state.source);
    state.route.onSaveDueDate(state.event(state.dueForm), assignment);
    state.route.onRequestReviewer(state.event(state.reviewerForm), assignment);
    state.route.onRequestHandover(state.event(state.handoverForm), assignment);
    await state.flush();

    expect(state.requests).toEqual([
      { path: "/api/work-sessions/start", method: "POST", body: { assignmentId: "assignment/1" } },
      { path: "/api/task-assignments/assignment%2F1/submit", method: "POST", body: undefined },
      {
        path: "/api/tasks/task%2F1/due-date",
        method: "PATCH",
        body: { dueDate: "2026-11-02", expectedDueDate: "2026-10-10", expectedDueDateRevision: 4 },
      },
      {
        path: "/api/task-assignments/assignment%2F1/reviewer-requests",
        method: "POST",
        body: { reviewerPersonId: "person-reviewer", reason: "Needs review" },
      },
      {
        path: "/api/task-assignments/assignment%2F1/handover-requests",
        method: "POST",
        body: { targetPersonId: "person-target", reason: "Moving teams" },
      },
    ]);
    expect(state.messages).toEqual([
      "Work session started.",
      "Assignment submitted.",
      "Due date updated; 2 active assignees notified.",
      "Reviewer request sent.",
      "Handover request sent.",
    ]);
    expect(state.refreshes).toHaveLength(5);
    expect(state.submitted.map((event) => event.currentTarget)).toEqual([
      state.dueForm, state.reviewerForm, state.handoverForm,
    ]);
  });

  it("does not update Work feedback or refresh after a command becomes stale", async () => {
    const state = harness({ current: false });
    state.route.onStart(assignment, state.source);
    state.route.onSaveDueDate(state.event(state.dueForm), assignment);
    await state.flush();

    expect(state.requests).toHaveLength(2);
    expect(state.messages).toEqual([]);
    expect(state.refreshes).toEqual([]);
  });
});
