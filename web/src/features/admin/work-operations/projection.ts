import type {
  WorkOperationsAssignment,
  WorkOperationsProjectionInput,
  WorkOperationsRead,
  WorkOperationsTask,
} from "./contracts";

const deniedCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);

/** Project only the task and people fields consumed by the Admin operations UI. */
export function projectWorkOperations(input: WorkOperationsProjectionInput): {
  taskRead: WorkOperationsRead<WorkOperationsTask>;
} {
  return {
    taskRead: projectTaskRead(input.taskRead, input.hasTaskPermission),
  };
}

function projectTaskRead(
  read: WorkOperationsRead<unknown>,
  hasPermission: WorkOperationsProjectionInput["hasTaskPermission"],
): WorkOperationsRead<WorkOperationsTask> {
  if (read.status !== "ready") return read;
  const items: WorkOperationsTask[] = [];
  for (const value of read.items) {
    const task = record(value);
    if (!task) return invalidTaskRead();
    const id = nonEmpty(task.id);
    const title = nonEmpty(task.title);
    const status = nonEmpty(task.status);
    if (!id || !title || !status || !Array.isArray(task.assignments)) return invalidTaskRead();
    const assignments = task.assignments.map((assignment) => projectAssignment(assignment, task, hasPermission));
    if (assignments.some((assignment) => assignment === null)) return invalidTaskRead();

    const client = record(task.client);
    const workstream = record(task.workstream);
    const workstreamKind = workstream?.kind === "client" || workstream?.kind === "organisation"
      ? workstream.kind
      : null;
    if (!workstreamKind) return invalidTaskRead();
    const dueDateRevision = Number.isSafeInteger(task.dueDateRevision) && Number(task.dueDateRevision) >= 0
      ? Number(task.dueDateRevision)
      : 0;
    const canEditDueDate = task.canEditDueDate === true &&
      dueDateRevision === task.dueDateRevision && hasPermission("tasks.edit", task);
    const canAssign = task.canAssign === true && hasPermission("tasks.assign", task);
    const canCancel = task.canCancel === true && hasPermission("tasks.edit", task);

    const correctionOf = record(task.correctionOf);
    const definition = record(task.taskDefinition);
    items.push({
      id,
      title,
      description: nullableText(task.description),
      status,
      priority: nonEmpty(task.priority) || "normal",
      clientName: nullableText(client?.name),
      workstreamName: nonEmpty(workstream?.name) || "workstream",
      workstreamKind,
      dueDate: nullableText(task.dueDate),
      dueDateRevision,
      billingConfirmation: billingConfirmation(task),
      definitionProvenance: definition
        ? `selected definition · revision ${safeRevision(definition.revision)}`
        : "one-off task path",
      isCorrection: task.isCorrection === true,
      correctionOfTitle: nullableText(correctionOf?.title),
      correctionReason: nullableText(task.correctionReason),
      canEditDueDate,
      canAssign,
      canCancel,
      assignments: assignments as WorkOperationsAssignment[],
    });
  }
  return { status: "ready", items };
}

function projectAssignment(
  value: unknown,
  task: Record<string, unknown>,
  hasPermission: WorkOperationsProjectionInput["hasTaskPermission"],
): WorkOperationsAssignment | null {
  const assignment = record(value);
  if (!assignment) return null;
  const id = nonEmpty(assignment.id);
  const personId = nonEmpty(assignment.personId);
  const personName = nonEmpty(assignment.personName);
  const status = nonEmpty(assignment.status);
  if (!id || !personId || !personName || !status) return null;
  return {
    id,
    personId,
    personName,
    reviewerPersonId: nullableText(assignment.reviewerPersonId),
    reviewerName: nullableText(assignment.reviewerName),
    reviewRequired: assignment.reviewRequired === true,
    resolutionSource: nullableText(assignment.resolutionSource),
    reviewBlockedReason: nullableText(assignment.reviewBlockedReason),
    status,
    canReassign: assignment.canReassign === true && hasPermission("tasks.reassign", task),
  };
}

function billingConfirmation(task: Record<string, unknown>): string {
  const billingClass = task.billingClass === "billable"
    ? "Billable"
    : task.billingClass === "non_billable" ? "Non-billable" : "classified automatically";
  const source = task.billingPolicySource === "client_workstream_task_definition"
    ? "predefined-task rule"
    : task.billingPolicySource === "client_workstream" ? "client workstream default"
      : task.billingPolicySource === "organisation_default" ? "organisation default"
        : task.billingPolicySource === "legacy_snapshot" ? "legacy classification snapshot" : "workstream policy";
  const revision = Number.isSafeInteger(task.billingPolicyRevision) && Number(task.billingPolicyRevision) > 0
    ? ` · policy r${task.billingPolicyRevision}`
    : "";
  return `NOVA automatically classified this task as ${billingClass} · ${source}${revision}`;
}

function invalidTaskRead(): WorkOperationsRead<WorkOperationsTask> {
  return { status: "error", message: "The task list response was incomplete. Refresh Admin to try again." };
}

export function projectReadResult<T>(
  result: unknown,
  key: string,
  resource: string,
): WorkOperationsRead<T> {
  const source = record(result);
  if (!source) return { status: "error", message: `The ${resource} response could not be read. Refresh Admin to try again.` };
  const code = typeof source.readError === "string" ? source.readError : "";
  if (code) {
    if (deniedCodes.has(code)) {
      const detail = code === "PREREQUISITE_PERMISSION_REQUIRED" && typeof source.requiredPermission === "string"
        ? ` ${source.requiredPermission} is required for this read.`
        : "";
      return { status: "unavailable", message: `You cannot load ${resource}.${detail}` };
    }
    return { status: "error", message: `Could not load ${resource}. Refresh Admin to try again.` };
  }
  return Array.isArray(source[key])
    ? { status: "ready", items: source[key] as T[] }
    : { status: "error", message: `The ${resource} response was incomplete. Refresh Admin to try again.` };
}

function safeRevision(value: unknown): string {
  return Number.isSafeInteger(value) && Number(value) > 0 ? String(value) : "unavailable";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
