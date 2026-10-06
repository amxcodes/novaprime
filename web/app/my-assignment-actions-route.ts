import type { FormEvent } from "react";
import type { WorkAssignment, WorkMyAssignmentsProps } from "../src/features/work/contracts.ts";

type CommandContext = unknown;
type FormWork = (context: CommandContext) => Promise<void> | void;
type Api = (path: string, options: RequestInit) => Promise<unknown>;
type RequestOptions = (method: string, body?: unknown) => RequestInit;
type RunActionButton = (source: HTMLButtonElement, work: FormWork) => Promise<void>;
type WithSubmit = (event: FormEvent<HTMLFormElement>, work: FormWork) => Promise<unknown>;

interface MyAssignmentActionServices {
  api: Api;
  requestOptions: RequestOptions;
  runActionButton: RunActionButton;
  withSubmit: WithSubmit;
  isCurrentCommand: (context: CommandContext) => boolean;
  formValues: (form: HTMLFormElement) => Record<string, FormDataEntryValue>;
  setMessage: (message: string) => void;
  refreshWork: () => void;
}

type MyAssignmentActions = Pick<
  WorkMyAssignmentsProps,
  "onStart" | "onSubmit" | "onSaveDueDate" | "onRequestReviewer" | "onRequestHandover"
>;

/** Compose Mine action callbacks while leaving transport and command lifetime to the host. */
export function createMyAssignmentActionsRoute(services: MyAssignmentActionServices): MyAssignmentActions {
  const { api, requestOptions, runActionButton, withSubmit, isCurrentCommand, formValues, setMessage, refreshWork } = services;
  const runAssignmentAction = (
    source: HTMLButtonElement,
    path: string,
    message: string,
    options: () => RequestInit,
  ): void => {
    void runActionButton(source, async (context) => {
      await api(path, options());
      if (!isCurrentCommand(context)) return;
      setMessage(message);
      refreshWork();
    });
  };

  const runAssignmentForm = (
    event: FormEvent<HTMLFormElement>,
    work: (form: HTMLFormElement, values: Record<string, FormDataEntryValue>, context: CommandContext) => Promise<void>,
  ): void => {
    const form = event.currentTarget;
    const values = formValues(form);
    void withSubmit(event, (context) => work(form, values, context));
  };

  return {
    onStart: (assignment, source) => runAssignmentAction(
      source,
      "/api/work-sessions/start",
      "Work session started.",
      () => requestOptions("POST", { assignmentId: assignment.assignmentId }),
    ),
    onSubmit: (assignment, source) => runAssignmentAction(
      source,
      "/api/task-assignments/" + encodeURIComponent(assignment.assignmentId) + "/submit",
      "Assignment submitted.",
      () => requestOptions("POST"),
    ),
    onSaveDueDate: (event, assignment) => runAssignmentForm(event, async (_form, values, context) => {
      const result = await api("/api/tasks/" + encodeURIComponent(assignment.taskId) + "/due-date", requestOptions("PATCH", {
        dueDate: String(values.dueDate || "").trim() || null,
        expectedDueDate: assignment.dueDate || null,
        expectedDueDateRevision: assignment.dueDateRevision,
      })) as Record<string, unknown>;
      if (!isCurrentCommand(context)) return;
      const notifiedCount = Number(result.notifiedAssigneeCount || 0);
      const notificationMessage = notifiedCount === 0
        ? "No active assignees to notify."
        : `${notifiedCount} active assignee${notifiedCount === 1 ? "" : "s"} notified.`;
      setMessage(result.changed ? `Due date updated; ${notificationMessage}` : "Due date is unchanged.");
      refreshWork();
    }),
    onRequestReviewer: (event, assignment) => runAssignmentForm(event, async (_form, values, context) => {
      await api(
        "/api/task-assignments/" + encodeURIComponent(assignment.assignmentId) + "/reviewer-requests",
        requestOptions("POST", values),
      );
      if (!isCurrentCommand(context)) return;
      setMessage("Reviewer request sent.");
      refreshWork();
    }),
    onRequestHandover: (event, assignment) => runAssignmentForm(event, async (_form, values, context) => {
      await api(
        "/api/task-assignments/" + encodeURIComponent(assignment.assignmentId) + "/handover-requests",
        requestOptions("POST", values),
      );
      if (!isCurrentCommand(context)) return;
      setMessage("Handover request sent.");
      refreshWork();
    }),
  };
}
