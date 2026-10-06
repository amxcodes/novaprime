import type {
  AuthorizedOptions,
  TaskCatalogOption,
  TaskComposerProps,
  TaskCorrectionOption,
  TaskCreateInput,
  TaskCreationTargetOption,
  TaskDepartmentOption,
  TaskGroupOption,
  TaskPriority,
  TaskWorkstreamKind,
} from "./contracts";

export interface TaskComposerDraft {
  targetKey: string;
  title: string;
  catalogEntryId: string;
  groupId: string;
  departmentId: string;
  description: string;
  priority: string;
  dueDate: string;
  correctionOfTaskId: string;
  correctionReason: string;
  assignToSelf: boolean;
}

export type TaskComposerField = keyof TaskComposerDraft;
export type TaskComposerErrors = Partial<Record<TaskComposerField, string>>;

export interface TaskComposerParseResult {
  input?: TaskCreateInput;
  errors: TaskComposerErrors;
}

function readyItems<T>(options?: AuthorizedOptions<T>): readonly T[] {
  return options?.status === "ready" ? options.items : [];
}

export function targetLabel(target: TaskCreationTargetOption): string {
  const workstream = target.kind === "client"
    ? `${target.clientName || "Client"} · ${target.name}`
    : `Organisation · ${target.name}`;
  return target.groupName ? `${workstream} · Group · ${target.groupName}` : workstream;
}

export function choiceOptionLabel<T extends { name?: string; title?: string; clientName?: string }>(option: T): string {
  if (typeof option.title === "string") return option.title;
  if (typeof option.name === "string") return option.name;
  return option.clientName || "Option";
}

export function isValidTaskDueDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function sameWorkstream(
  left: { workstreamId: string; workstreamKind: TaskWorkstreamKind },
  right: { id: string; kind: TaskWorkstreamKind },
): boolean {
  return left.workstreamId === right.id && left.workstreamKind === right.kind;
}

export function parseTaskComposerDraft(
  draft: TaskComposerDraft,
  props: Pick<TaskComposerProps, "targets" | "groups" | "catalog" | "corrections" | "departments" | "selfAssignment">,
): TaskComposerParseResult {
  const errors: TaskComposerErrors = {};
  const targets = readyItems(props.targets);
  const target = targets.find((item) => item.key === draft.targetKey);
  if (!target) errors.targetKey = "Choose a workstream available for task creation.";

  const catalogEntries = readyItems<TaskCatalogOption>(props.catalog);
  const hasCatalogSelection = draft.catalogEntryId.length > 0;
  const catalogEntry = hasCatalogSelection
    ? catalogEntries.find((item) => item.id === draft.catalogEntryId)
    : undefined;
  if (hasCatalogSelection && !catalogEntry) errors.catalogEntryId = "This task definition is no longer available. Choose another option or create a one-off task.";

  const title = draft.title.trim();
  if (!title && !catalogEntry) errors.title = "Enter a task title or choose a task definition.";
  if (title.length > 320) errors.title = "Task titles can be up to 320 characters.";
  if (draft.description.length > 10000) errors.description = "Descriptions can be up to 10,000 characters.";
  if (!(["low", "normal", "high", "urgent"] as string[]).includes(draft.priority)) {
    errors.priority = "Choose a valid priority.";
  }
  if (draft.dueDate && !isValidTaskDueDate(draft.dueDate)) errors.dueDate = "Enter a valid due date.";

  const groups = readyItems<TaskGroupOption>(props.groups);
  let group: TaskGroupOption | undefined;
  if (target?.requiredGroupId) {
    group = groups.find((item) => item.id === target.requiredGroupId && sameWorkstream(item, target));
    // The target itself is already host-projected as a group-scoped creation target.
    if (!group && target.groupName) group = { id: target.requiredGroupId, name: target.groupName, workstreamId: target.id, workstreamKind: target.kind };
  } else if (draft.groupId) {
    group = groups.find((item) => item.id === draft.groupId && sameWorkstream(item, target || { id: "", kind: "client" }));
    if (!group) errors.groupId = "Choose a group available in the selected workstream.";
  }

  let department: TaskDepartmentOption | undefined;
  if (draft.departmentId) {
    department = readyItems<TaskDepartmentOption>(props.departments).find((item) => item.id === draft.departmentId);
    if (!department) errors.departmentId = "Choose a department from the available options.";
  }

  let correction: TaskCorrectionOption | undefined;
  if (draft.correctionOfTaskId) {
    correction = readyItems<TaskCorrectionOption>(props.corrections).find((item) => item.id === draft.correctionOfTaskId);
    if (!correction || !target || !sameWorkstream(correction, target)) {
      errors.correctionOfTaskId = "Choose completed work in the selected workstream.";
    }
    const reason = draft.correctionReason.trim();
    if (!reason) errors.correctionReason = "Describe what needs correcting.";
    else if (reason.length > 2000) errors.correctionReason = "Correction reasons can be up to 2,000 characters.";
  }

  if (Object.keys(errors).length || !target) return { errors };

  const priority = draft.priority as TaskPriority;
  return {
    errors,
    input: {
      title,
      ...(target.kind === "client" ? { clientWorkstreamId: target.id } : { organisationWorkstreamId: target.id }),
      ...(target.requiredGroupId || group?.id ? { workGroupId: target.requiredGroupId || group?.id } : {}),
      ...(department ? { organisationDepartmentId: department.id } : {}),
      ...(catalogEntry ? {
        taskCatalogEntryId: catalogEntry.id,
        taskCatalogRevision: catalogEntry.revision,
      } : {}),
      description: draft.description.trim() || null,
      priority,
      dueDate: draft.dueDate || null,
      correctionOfTaskId: correction?.id || null,
      correctionReason: correction ? draft.correctionReason.trim() : null,
      assignToSelf: props.selfAssignment.status === "eligible" && draft.assignToSelf,
    },
  };
}

/** Preserve hand-edited values while switching away from a definition's untouched defaults. */
export function applyCatalogSelection(
  draft: TaskComposerDraft,
  nextId: string,
  entries: readonly TaskCatalogOption[],
): TaskComposerDraft {
  const previous = entries.find((entry) => entry.id === draft.catalogEntryId);
  const next = entries.find((entry) => entry.id === nextId);
  const nextDraft = { ...draft, catalogEntryId: next?.id || "" };
  if (previous) {
    if (draft.title === previous.title) nextDraft.title = "";
    if (draft.description === (previous.description || "")) nextDraft.description = "";
    if (draft.priority === previous.priority) nextDraft.priority = "normal";
  }
  if (next) {
    nextDraft.title = next.title;
    nextDraft.description = next.description || "";
    nextDraft.priority = next.priority;
  }
  return nextDraft;
}
