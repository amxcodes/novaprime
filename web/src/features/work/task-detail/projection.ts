import type { WorkTaskDetailAssignment, WorkTaskDetailRecord } from "./contracts";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function projectAssignment(value: unknown): WorkTaskDetailAssignment | null {
  if (!isRecord(value)) return null;
  return {
    personName: nullableText(value.personName),
    reviewerName: nullableText(value.reviewerName),
    reviewRequired: value.reviewRequired === true,
    reviewBlockedReason: nullableText(value.reviewBlockedReason),
    status: nullableText(value.status) ?? "unknown",
  };
}

/** Copy only display fields into React; server identifiers and write revisions never cross this boundary. */
export function projectWorkTaskDetail(value: unknown): WorkTaskDetailRecord {
  const task = isRecord(value) ? value : {};
  const client = isRecord(task.client) ? task.client : {};
  const workstream = isRecord(task.workstream) ? task.workstream : {};
  const group = isRecord(task.group) ? task.group : {};
  const department = isRecord(task.department) ? task.department : {};
  const taskDefinition = isRecord(task.taskDefinition) ? task.taskDefinition : null;
  const correctionOf = isRecord(task.correctionOf) ? task.correctionOf : null;
  const assignments = Array.isArray(task.assignments)
    ? task.assignments.map(projectAssignment).filter((assignment): assignment is WorkTaskDetailAssignment => assignment !== null)
    : [];

  return {
    title: nullableText(task.title) ?? "Untitled task",
    description: nullableText(task.description),
    status: nullableText(task.status) ?? "unknown",
    priority: nullableText(task.priority) ?? "normal",
    createdAt: nullableText(task.createdAt),
    dueDate: nullableText(task.dueDate),
    canEditDueDate: task.canEditDueDate === true && nullableRevision(task.dueDateRevision) !== null,
    billingClass: nullableText(task.billingClass),
    billingPolicySource: nullableText(task.billingPolicySource),
    billingPolicyRevision: nullableRevision(task.billingPolicyRevision),
    taskDefinitionRevision: nullableRevision(taskDefinition?.revision),
    isCorrection: task.isCorrection === true,
    correctionReason: nullableText(task.correctionReason),
    // The endpoint returns this title only when the viewer can open the source task.
    correctionTitle: nullableText(correctionOf?.title),
    clientName: nullableText(client.name),
    workstreamName: nullableText(workstream.name),
    workstreamKind: workstream.kind === "client" ? "client" : "organisation",
    groupName: nullableText(group.name),
    departmentName: nullableText(department.name),
    assignments,
  };
}
