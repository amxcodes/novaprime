import type { TaskCreateInput } from "../src/features/work/task-composer/contracts.ts";

type Lifetime = unknown;
type RequestOptions = (method: string, body?: unknown, headers?: Record<string, string>) => RequestInit;
type CreatedTask = {
  assignmentId?: unknown;
  billingClass?: unknown;
  billingPolicySource?: unknown;
  billingPolicyRevision?: unknown;
};
type SubmissionResult =
  | { status: "ready"; payload: TaskCreateInput }
  | { status: "invalid"; reason: string };
type RunCommand = (
  source: Element,
  lifetime: Lifetime,
  work: () => Promise<CreatedTask>,
  resource: string,
) => Promise<CreatedTask>;

interface WorkTaskComposerActionServices {
  target: Element;
  lifetime: Lifetime;
  isCurrentPageRequest: (lifetime: Lifetime) => boolean;
  canCreateTask: () => boolean;
  resolveSubmission: (input: TaskCreateInput) => SubmissionResult;
  runCommand: RunCommand;
  api: (path: string, options: RequestInit) => Promise<CreatedTask>;
  requestOptions: RequestOptions;
  idempotencyHeaders: (payload: TaskCreateInput) => Record<string, string>;
  clearIdempotency: (payload: TaskCreateInput) => void;
  pageChangedError: () => Error;
  permissionDeniedError: () => Error;
  billingConfirmation: (task: CreatedTask) => string;
  correctionConfirmation: (isCorrection: boolean) => string;
  setMessage: (message: string) => void;
  refreshWork: () => unknown;
}

/** Compose Work task submission while leaving grants, transport, and command lifetime to the route host. */
export function createWorkTaskComposerSubmitAction(services: WorkTaskComposerActionServices) {
  const {
    target,
    lifetime,
    isCurrentPageRequest,
    canCreateTask,
    resolveSubmission,
    runCommand,
    api,
    requestOptions,
    idempotencyHeaders,
    clearIdempotency,
    pageChangedError,
    permissionDeniedError,
    billingConfirmation,
    correctionConfirmation,
    setMessage,
    refreshWork,
  } = services;

  return async (input: TaskCreateInput): Promise<void> => {
    if (!target.isConnected || !isCurrentPageRequest(lifetime)) throw pageChangedError();
    if (!canCreateTask()) throw permissionDeniedError();
    const submission = resolveSubmission(input);
    if (submission.status !== "ready") throw permissionDeniedError();
    const { payload } = submission;
    const createdTask = await runCommand(
      target,
      lifetime,
      () => api("/api/tasks", requestOptions("POST", payload, idempotencyHeaders(payload))),
      "Work",
    );
    clearIdempotency(payload);
    setMessage((createdTask.assignmentId
      ? "Task created and added to your assignments."
      : "Task created without assigning it to you.") + " · " + billingConfirmation(createdTask) +
      correctionConfirmation(Boolean(payload.correctionOfTaskId)));
    refreshWork();
  };
}
