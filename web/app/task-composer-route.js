const deniedReadErrors = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);
const workstreamKinds = new Set(["client", "organisation"]);
const taskPriorities = new Set(["low", "normal", "high", "urgent"]);

const notRequested = Object.freeze({ status: "not-requested" });

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, maximumLength = 500) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximumLength ? text : null;
}

function safeId(value) {
  return safeText(value, 200);
}

function readFailure(result, label) {
  if (deniedReadErrors.has(result?.readError)) {
    return {
      status: "denied",
      message: `Your role cannot load ${label}.`,
    };
  }
  if (result?.readError) {
    return {
      status: "error",
      message: `${label[0].toUpperCase()}${label.slice(1)} could not load. Refresh the page to try again.`,
    };
  }
  return null;
}

function failedRead(result, label) {
  return readFailure(result, label) || {
    status: "error",
    message: `${label[0].toUpperCase()}${label.slice(1)} could not be read. Refresh the page to try again.`,
  };
}

function projectWorkstreamTarget(target) {
  if (!isRecord(target)) return null;
  const id = safeId(target.id);
  const kind = target.kind;
  const name = safeText(target.name);
  if (!id || !name || !workstreamKinds.has(kind)) return null;

  const requiredGroupId = safeId(target.requiredGroupId);
  if (target.requiredGroupId != null && target.requiredGroupId !== "" && !requiredGroupId) return null;
  const groupName = requiredGroupId ? safeText(target.groupName) : null;
  if (requiredGroupId && !groupName) return null;
  const billingPolicyClass = target.billingPolicyClass === "billable" || target.billingPolicyClass === "non_billable"
    ? target.billingPolicyClass
    : null;
  const targetKey = `${kind}:${id}${requiredGroupId ? `:group:${requiredGroupId}` : ""}`;

  return {
    key: targetKey,
    id,
    kind,
    name,
    ...(kind === "client" && safeText(target.clientName) ? { clientName: safeText(target.clientName) } : {}),
    billingPolicyClass,
    ...(requiredGroupId ? { requiredGroupId, groupName } : {}),
  };
}

function projectGroups(groups) {
  return groups.flatMap((group) => {
    if (!isRecord(group) || group.canCreateTask !== true) return [];
    const id = safeId(group.id);
    const name = safeText(group.name);
    const clientWorkstreamId = safeId(group.clientWorkstreamId);
    const organisationWorkstreamId = safeId(group.organisationWorkstreamId);
    if (!id || !name || Boolean(clientWorkstreamId) === Boolean(organisationWorkstreamId)) return [];
    return [{
      id,
      name,
      workstreamId: clientWorkstreamId || organisationWorkstreamId,
      workstreamKind: clientWorkstreamId ? "client" : "organisation",
    }];
  });
}

function projectCatalogEntries(entries) {
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = safeId(entry.id);
    const title = safeText(entry.title);
    const priority = taskPriorities.has(entry.priority) ? entry.priority : null;
    const revision = Number.isSafeInteger(entry.revision) && entry.revision > 0 ? entry.revision : null;
    const description = entry.description === null || entry.description === undefined
      ? null
      : safeText(entry.description, 10000);
    if (!id || !title || !priority || !revision || (entry.description != null && description === null)) return [];
    return [{ id, title, description, priority, revision }];
  });
}

function projectCorrections(tasks) {
  return tasks.flatMap((task) => {
    if (!isRecord(task) || !["approved", "done"].includes(task.status) || task.isCorrection !== false) return [];
    const id = safeId(task.id);
    const title = safeText(task.title);
    const workstream = task.workstream;
    const workstreamId = isRecord(workstream) ? safeId(workstream.id) : null;
    const workstreamKind = isRecord(workstream) ? workstream.kind : null;
    if (!id || !title || !workstreamId || !workstreamKinds.has(workstreamKind)) return [];
    return [{ id, title, workstreamId, workstreamKind }];
  });
}

function projectDepartments(departments) {
  return departments.flatMap((department) => {
    if (!isRecord(department)) return [];
    const id = safeId(department.id);
    const name = safeText(department.name);
    return id && name ? [{ id, name }] : [];
  });
}

function projectRequestedRead({ requested, result, key, label, project }) {
  if (requested !== true) return notRequested;
  if (!isRecord(result)) return failedRead(undefined, label);
  const failure = readFailure(result, label);
  if (failure) return failure;
  if (!Array.isArray(result[key])) return failedRead(result, label);
  return { status: "ready", items: project(result[key]) };
}

/**
 * Build the data-only portion of TaskComposer props from the route's authorized reads.
 * This adapter is presentation projection only; the route host and API remain authoritative.
 */
export function projectTaskComposerOptions({
  canCreate,
  workContextResult,
  catalogResult,
  catalogRequested,
  correctionTasksResult,
  correctionsRequested,
  departmentsResult,
  departmentsRequested,
} = {}) {
  const createAllowed = canCreate === true;
  let targets = notRequested;
  let groups = notRequested;
  let selfAssignment = { status: "unavailable", message: "Self-assignment eligibility could not be confirmed." };

  if (createAllowed) {
    if (!isRecord(workContextResult)) {
      targets = failedRead(undefined, "workstream options");
      groups = failedRead(undefined, "group options");
    } else {
      const contextFailure = readFailure(workContextResult, "workstream options");
      if (contextFailure) {
        targets = contextFailure;
        groups = {
          ...contextFailure,
          message: contextFailure.status === "denied"
            ? "Your role cannot load group options."
            : "Group options could not load. Refresh the page to try again.",
        };
      } else {
        targets = Array.isArray(workContextResult.taskCreationTargets)
          ? { status: "ready", items: workContextResult.taskCreationTargets.map(projectWorkstreamTarget).filter(Boolean) }
          : failedRead(workContextResult, "workstream options");
        groups = Array.isArray(workContextResult.groups)
          ? { status: "ready", items: projectGroups(workContextResult.groups) }
          : failedRead(workContextResult, "group options");

        if (workContextResult.canReceiveAssignments === true) {
          selfAssignment = { status: "eligible" };
        } else if (workContextResult.canReceiveAssignments === false) {
          selfAssignment = { status: "ineligible" };
        }
      }
    }
  }

  const catalog = createAllowed
    ? projectRequestedRead({
      requested: catalogRequested,
      result: catalogResult,
      key: "entries",
      label: "task definitions",
      project: projectCatalogEntries,
    })
    : notRequested;

  if (catalog.status === "ready" &&
      !(catalogResult?.permissions?.view === true || catalogResult?.permissions?.manage === true)) {
    catalog.status = "denied";
    catalog.message = "Your role cannot load task definitions.";
    delete catalog.items;
  }

  const corrections = createAllowed
    ? projectRequestedRead({
      requested: correctionsRequested,
      result: correctionTasksResult,
      key: "tasks",
      label: "completed task options",
      project: projectCorrections,
    })
    : notRequested;

  const departments = createAllowed
    ? projectRequestedRead({
      requested: departmentsRequested,
      result: departmentsResult,
      key: "departments",
      label: "department options",
      project: projectDepartments,
    })
    : notRequested;

  return {
    canCreate: createAllowed,
    targets,
    groups,
    catalog,
    corrections,
    departments,
    selfAssignment,
  };
}

/**
 * Revalidate selected options against the authorized projection and its source
 * reads, then build the existing task-create payload. The route host must still
 * enforce grants, request lifetime, and command authorization before dispatch.
 */
export function resolveTaskComposerSubmission(input, {
  composerOptions,
  workContextResult,
  catalogResult,
  correctionTasksResult,
  departmentsResult,
} = {}) {
  if (!isRecord(input)) return { status: "invalid", reason: "target-unavailable" };
  if (Boolean(input.clientWorkstreamId) === Boolean(input.organisationWorkstreamId)) {
    return { status: "invalid", reason: "target-unavailable" };
  }

  const targets = composerOptions?.targets?.status === "ready" && Array.isArray(composerOptions.targets.items)
    ? composerOptions.targets.items
    : [];
  const selectedTargetId = input.clientWorkstreamId || input.organisationWorkstreamId;
  const selectedTargetKind = input.clientWorkstreamId ? "client" : "organisation";
  const targetCandidates = targets.filter((candidate) =>
    candidate.id === selectedTargetId && candidate.kind === selectedTargetKind,
  );
  // Group-scoped grants can expose several options for one workstream. The
  // composer input carries the chosen group, so use it to recover that target.
  // A parent-scoped target remains the fallback and can use any projected group.
  const selectedTarget = (input.workGroupId
    ? targetCandidates.find((candidate) => candidate.requiredGroupId === input.workGroupId)
    : undefined) || targetCandidates.find((candidate) => !candidate.requiredGroupId) || targetCandidates[0];
  if (!selectedTarget) return { status: "invalid", reason: "target-unavailable" };

  const rawTargets = Array.isArray(workContextResult?.taskCreationTargets)
    ? workContextResult.taskCreationTargets
    : [];
  const rawTarget = rawTargets.find((candidate) =>
    candidate?.id === selectedTarget.id && candidate?.kind === selectedTarget.kind &&
    (candidate?.requiredGroupId || null) === (selectedTarget.requiredGroupId || null),
  );
  if (!rawTarget) return { status: "invalid", reason: "target-stale" };

  if (selectedTarget.requiredGroupId) {
    if (input.workGroupId !== selectedTarget.requiredGroupId) {
      return { status: "invalid", reason: "group-required" };
    }
  } else if (input.workGroupId) {
    const projectedGroupAllowed = composerOptions.groups?.status === "ready" && Array.isArray(composerOptions.groups.items) && composerOptions.groups.items.some((group) =>
      group.id === input.workGroupId && group.workstreamId === selectedTarget.id &&
      group.workstreamKind === selectedTarget.kind,
    );
    const rawGroups = Array.isArray(workContextResult?.groups) ? workContextResult.groups : [];
    const rawGroupAllowed = rawGroups.some((group) =>
      group?.id === input.workGroupId && group.canCreateTask === true &&
      (selectedTarget.kind === "client"
        ? group.clientWorkstreamId === selectedTarget.id
        : group.organisationWorkstreamId === selectedTarget.id),
    );
    if (!projectedGroupAllowed || !rawGroupAllowed) {
      return { status: "invalid", reason: "group-unavailable" };
    }
  }

  if (input.taskCatalogEntryId) {
    const projectedCatalogAllowed = composerOptions.catalog?.status === "ready" && Array.isArray(composerOptions.catalog.items) && composerOptions.catalog.items.some((entry) =>
      entry.id === input.taskCatalogEntryId && entry.revision === input.taskCatalogRevision,
    );
    const rawCatalogAllowed = (catalogResult?.permissions?.view === true || catalogResult?.permissions?.manage === true) &&
      Array.isArray(catalogResult?.entries) && catalogResult.entries.some((entry) =>
        entry.id === input.taskCatalogEntryId && entry.revision === input.taskCatalogRevision,
      );
    if (!projectedCatalogAllowed || !rawCatalogAllowed) {
      return { status: "invalid", reason: "catalog-unavailable" };
    }
  }

  if (input.correctionOfTaskId) {
    const projectedCorrectionAllowed = composerOptions.corrections?.status === "ready" && Array.isArray(composerOptions.corrections.items) && composerOptions.corrections.items.some((task) =>
      task.id === input.correctionOfTaskId && task.workstreamId === selectedTarget.id &&
      task.workstreamKind === selectedTarget.kind,
    );
    const rawTasks = Array.isArray(correctionTasksResult?.tasks) ? correctionTasksResult.tasks : [];
    const rawCorrectionAllowed = rawTasks.some((task) =>
      task.id === input.correctionOfTaskId && ["approved", "done"].includes(task.status) &&
      task.isCorrection === false && task.workstream?.id === selectedTarget.id && task.workstream?.kind === selectedTarget.kind,
    );
    if (!projectedCorrectionAllowed || !rawCorrectionAllowed) {
      return { status: "invalid", reason: "correction-unavailable" };
    }
  }

  if (input.organisationDepartmentId) {
    const projectedDepartmentAllowed = composerOptions.departments?.status === "ready" && Array.isArray(composerOptions.departments.items) && composerOptions.departments.items.some((department) =>
      department.id === input.organisationDepartmentId,
    );
    const rawDepartments = Array.isArray(departmentsResult?.departments) ? departmentsResult.departments : [];
    const rawDepartmentAllowed = rawDepartments.some((department) => department?.id === input.organisationDepartmentId);
    if (!projectedDepartmentAllowed || !rawDepartmentAllowed) {
      return { status: "invalid", reason: "department-unavailable" };
    }
  }

  const payload = {
    title: input.title,
    ...(input.clientWorkstreamId ? { clientWorkstreamId: input.clientWorkstreamId } : { organisationWorkstreamId: input.organisationWorkstreamId }),
    ...(input.workGroupId ? { workGroupId: input.workGroupId } : {}),
    ...(input.organisationDepartmentId ? { organisationDepartmentId: input.organisationDepartmentId } : {}),
    ...(input.taskCatalogEntryId ? { taskCatalogEntryId: input.taskCatalogEntryId, taskCatalogRevision: input.taskCatalogRevision } : {}),
    description: input.description,
    priority: input.priority,
    dueDate: input.dueDate,
    correctionOfTaskId: input.correctionOfTaskId,
    correctionReason: input.correctionReason,
    assignToSelf: input.assignToSelf === true && composerOptions.selfAssignment?.status === "eligible" &&
      workContextResult?.canReceiveAssignments === true,
  };
  return { status: "ready", payload };
}
