import { resolveTaskComposerSubmission } from "./task-composer-route.js";

const taskCreateScopes = Object.freeze(["organisation", "client", "client_workstream", "group"]);
const submissionErrorMessages = Object.freeze({
  "target-unavailable": "Choose a workstream that is still available for task creation.",
  "target-stale": "This workstream is no longer available. Refresh Admin and try again.",
  "group-required": "Choose the group required by this workstream.",
  "group-unavailable": "Choose a group that is available in this workstream.",
  "catalog-unavailable": "That task definition is no longer available. Refresh Admin and choose it again.",
  "correction-unavailable": "Choose a completed task in the selected workstream for this correction.",
  "department-unavailable": "Choose a department that is still available. Refresh Admin and try again.",
});

/**
 * Admin route adapter for TaskComposer.
 * Read projection stays in the existing task-composer projector; this module
 * binds its submit callback to authorized current options and the page host.
 */
export function createAdminTaskComposerRoute({
  state,
  target,
  lifetime,
  identityEpoch,
  actorPersonId,
  isCurrentPageRequest,
  canShowAdminFeature,
  hasAnyPermissionGrant,
  planAdminReads,
  projectTaskComposerOptions,
  pageApi,
  runProtectedCommand,
  adminCommandUiError,
  taskCreateIdempotencyHeaders,
  clearTaskCreateIdempotency,
  setMessage,
  taskBillingConfirmation,
  taskCorrectionConfirmation,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canShowAdminFeature,
    hasAnyPermissionGrant,
    planAdminReads,
    projectTaskComposerOptions,
    pageApi,
    runProtectedCommand,
    adminCommandUiError,
    taskCreateIdempotencyHeaders,
    clearTaskCreateIdempotency,
    setMessage,
    taskBillingConfirmation,
    taskCorrectionConfirmation,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  const mountedIdentityEpoch = identityEpoch ?? state.identityEpoch;
  const mountedActorPersonId = actorPersonId ?? currentActorPersonId(state);
  let searchCacheData = null;
  let searchCache = emptySearchCache();

  function isCurrent(data, current = state.adminData) {
    return target.isConnected === true &&
      isCurrentPageRequest(lifetime) &&
      state.identityEpoch === mountedIdentityEpoch &&
      currentActorPersonId(state) === mountedActorPersonId &&
      current === data &&
      state.adminData === data;
  }

  function requireCurrent(data, message = "The Admin page changed before this task could be created.") {
    if (!isCurrent(data)) throw adminCommandUiError(message);
  }

  function projectOptions(data) {
    ensureSearchCache(data);
    const readPlan = planAdminReads(data.actorGrants);
    const sources = mergeSearchCache(data, searchCache);
    return projectTaskComposerOptions({
      canCreate: hasAnyPermissionGrant(data.actorGrants, ["tasks.create"], taskCreateScopes),
      workContextResult: sources.workContext,
      catalogResult: sources.taskCatalog,
      catalogRequested: readPlan.taskCatalog,
      correctionTasksResult: sources.tasks,
      correctionsRequested: readPlan.tasks,
      departmentsResult: sources.departments,
      departmentsRequested: readPlan.departments,
    });
  }

  function ensureSearchCache(data) {
    if (searchCacheData === data) return;
    searchCacheData = data;
    searchCache = emptySearchCache();
  }

  function requireSearchAccess(data, targetOption) {
    requireCurrent(data, "Admin changed before task choices could be searched. Refresh and try again.");
    const current = state.adminData;
    if (!canShowAdminFeature(current.actorGrants, "work") ||
        !hasAnyPermissionGrant(current.actorGrants, ["tasks.create"], taskCreateScopes)) {
      throw adminCommandUiError("Your current access no longer allows task creation. Refresh Admin to check access.");
    }
    if (targetOption) {
      const currentOptions = projectOptions(current);
      const known = currentOptions.targets.status === "ready" &&
        currentOptions.targets.items.some((item) => sameTarget(item, targetOption));
      if (!known) throw adminCommandUiError("Choose a workstream that is still available for task creation.");
    }
  }

  async function searchWorkContext(data, query) {
    requireSearchAccess(data);
    const cleanQuery = boundedQuery(query);
    if (!cleanQuery) return null;
    const result = await pageApi("/api/work-context?q=" + encodeURIComponent(cleanQuery), lifetime);
    requireSearchAccess(data);
    const safe = safeWorkContextSearchResult(result);
    if (!safe) throw adminCommandUiError("Authorized workstream choices could not be searched. Refresh and try again.");
    rememberWorkContext(searchCache, safe);
    return safe;
  }

  async function searchTargets(data, query) {
    const result = await searchWorkContext(data, query);
    if (!result) return projectOptions(data).targets.status === "ready" ? projectOptions(data).targets.items : [];
    const projected = projectTaskComposerOptions({
      canCreate: true,
      workContextResult: result,
      catalogRequested: false,
      correctionsRequested: false,
      departmentsRequested: false,
    });
    return projected.targets.status === "ready" ? projected.targets.items : [];
  }

  async function searchGroups(data, targetOption, query) {
    requireSearchAccess(data, targetOption);
    const result = await searchWorkContext(data, query);
    if (!result) return projectOptions(data).groups.status === "ready"
      ? projectOptions(data).groups.items.filter((group) => sameWorkstream(group, targetOption))
      : [];
    const projected = projectTaskComposerOptions({
      canCreate: true,
      workContextResult: result,
      catalogRequested: false,
      correctionsRequested: false,
      departmentsRequested: false,
    });
    return projected.groups.status === "ready"
      ? projected.groups.items.filter((group) => sameWorkstream(group, targetOption))
      : [];
  }

  async function searchTargetResource(data, targetOption, resource, query) {
    requireSearchAccess(data, targetOption);
    const plan = planAdminReads(state.adminData.actorGrants);
    if ((resource === "catalog" && !plan.taskCatalog) ||
        (resource === "corrections" && !plan.tasks) ||
        (resource === "departments" && !plan.departments)) {
      return [];
    }
    const path = resource === "catalog" ? "/api/task-composer/catalog"
      : resource === "corrections" ? "/api/task-composer/correction-sources"
        : "/api/task-composer/departments";
    const params = new URLSearchParams({ workstreamKind: targetOption.kind, workstreamId: targetOption.id, q: boundedQuery(query) });
    if (targetOption.requiredGroupId) params.set("groupId", targetOption.requiredGroupId);
    const result = await pageApi(`${path}?${params.toString()}`, lifetime);
    requireSearchAccess(data, targetOption);
    if (resource === "catalog") {
      const safe = safeCatalogSearchResult(result);
      if (!safe) throw adminCommandUiError("Task definitions could not be searched. Refresh and try again.");
      rememberRows(searchCache.catalog, safe.entries, (row) => row.id);
      searchCache.catalogPermissions = safe.permissions;
      return safe.entries;
    }
    if (resource === "corrections") {
      const safe = safeCorrectionSearchResult(result, targetOption);
      if (!safe) throw adminCommandUiError("Completed tasks could not be searched. Refresh and try again.");
      rememberRows(searchCache.corrections, safe.tasks, (row) => row.id);
      return safe.options;
    }
    const safe = safeDepartmentSearchResult(result);
    if (!safe) throw adminCommandUiError("Department choices could not be searched. Refresh and try again.");
    rememberRows(searchCache.departments, safe.departments, (row) => row.id);
    return safe.departments;
  }

  function createProps(data) {
    requireCurrent(data, "Admin changed while task-creation controls were loading. Refresh and try again.");
    if (!canShowAdminFeature(data.actorGrants, "work")) {
      throw adminCommandUiError("Your current access no longer allows task creation. Refresh Admin to check access.");
    }
    const readPlan = planAdminReads(data.actorGrants);
    const canSearchCatalog = readPlan.taskCatalog && hasAnyPermissionGrant(
      data.actorGrants, ["tasks.catalog.view", "tasks.catalog.manage"], ["organisation"],
    );
    return {
      ...projectOptions(data),
      heading: "Create task",
      description: "Choose an authorized workstream, then define the task. Assignment and review remain separate; NOVA applies billing automatically.",
      selfAssignmentDefault: false,
      onSearchTargets: (query) => searchTargets(data, query),
      onSearchGroups: (targetOption, query) => searchGroups(data, targetOption, query),
      ...(canSearchCatalog
        ? { onSearchCatalog: (targetOption, query) => searchTargetResource(data, targetOption, "catalog", query) }
        : {}),
      ...(readPlan.tasks
        ? { onSearchCorrections: (targetOption, query) => searchTargetResource(data, targetOption, "corrections", query) }
        : {}),
      ...(readPlan.departments
        ? { onSearchDepartments: (targetOption, query) => searchTargetResource(data, targetOption, "departments", query) }
        : {}),
      onSubmit: (input) => submit(data, input),
    };
  }

  function resolveSubmission(data, input) {
    requireCurrent(data);
    const current = state.adminData;
    if (!canShowAdminFeature(current.actorGrants, "work") ||
        !hasAnyPermissionGrant(current.actorGrants, ["tasks.create"], taskCreateScopes)) {
      throw adminCommandUiError("Your current access no longer allows task creation. Refresh Admin to check access.");
    }
    const composerOptions = projectOptions(current);
    const sources = mergeSearchCache(current, searchCache);
    const resolution = resolveTaskComposerSubmission(input, {
      composerOptions,
      workContextResult: sources.workContext,
      catalogResult: sources.taskCatalog,
      correctionTasksResult: sources.tasks,
      departmentsResult: sources.departments,
    });
    if (resolution.status !== "ready") {
      throw adminCommandUiError(submissionErrorMessages[resolution.reason] || submissionErrorMessages["target-unavailable"]);
    }
    return { composerOptions, payload: resolution.payload };
  }

  function submit(data, input) {
    const { payload } = resolveSubmission(data, input);
    const isStillAllowed = (latest) => {
      if (!isCurrent(data, latest) || !canShowAdminFeature(latest?.actorGrants, "work") ||
          !hasAnyPermissionGrant(latest?.actorGrants, ["tasks.create"], taskCreateScopes)) return false;
      try {
        return JSON.stringify(resolveSubmission(data, input).payload) === JSON.stringify(payload);
      } catch {
        return false;
      }
    };
    return runProtectedCommand(
      isStillAllowed,
      {},
      "POST",
      "/api/tasks",
      payload,
      "Task created.",
      (createdTask) => {
        clearTaskCreateIdempotency(payload);
        setMessage((createdTask.assignmentId
          ? "Task created and added to your assignments."
          : "Task created without assigning it to you.") + " · " + taskBillingConfirmation(createdTask) +
          taskCorrectionConfirmation(Boolean(payload.correctionOfTaskId)));
      },
      taskCreateIdempotencyHeaders(payload),
    );
  }

  return { createProps };
}

function currentActorPersonId(state) {
  return state.identityPersonId || state.actorGrants?.actorPersonId || state.adminData?.actorGrants?.actorPersonId || null;
}

const cacheLimit = 1000;

function emptySearchCache() {
  return {
    targets: new Map(),
    groups: new Map(),
    catalog: new Map(),
    catalogPermissions: null,
    corrections: new Map(),
    departments: new Map(),
  };
}

function rememberRows(cache, rows, keyOf) {
  for (const row of rows) {
    const key = keyOf(row);
    if (cache.has(key)) cache.delete(key);
    cache.set(key, row);
  }
  while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
}

function boundedQuery(value) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function safeText(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function safeId(value) {
  return typeof value === "string" && value.length <= 200 ? value : null;
}

function safeWorkContextSearchResult(value) {
  if (!value || typeof value !== "object") return null;
  const targets = Array.isArray(value.taskCreationTargets) ? value.taskCreationTargets.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = safeId(item.id);
    const name = safeText(item.name);
    const kind = item.kind === "client" || item.kind === "organisation" ? item.kind : null;
    const requiredGroupId = item.requiredGroupId == null ? null : safeId(item.requiredGroupId);
    const groupName = item.groupName == null ? null : safeText(item.groupName);
    if (!id || !name || !kind || (item.requiredGroupId != null && (!requiredGroupId || !groupName))) return [];
    return [{
      id, name, kind,
      ...(kind === "client" && safeText(item.clientName) ? { clientName: safeText(item.clientName) } : {}),
      ...(item.billingPolicyClass === "billable" || item.billingPolicyClass === "non_billable"
        ? { billingPolicyClass: item.billingPolicyClass }
        : { billingPolicyClass: null }),
      ...(requiredGroupId ? { requiredGroupId, groupName } : {}),
    }];
  }) : null;
  const groups = Array.isArray(value.groups) ? value.groups.flatMap((item) => {
    if (!item || typeof item !== "object" || item.canCreateTask !== true) return [];
    const id = safeId(item.id);
    const name = safeText(item.name);
    const clientWorkstreamId = item.clientWorkstreamId == null ? null : safeId(item.clientWorkstreamId);
    const organisationWorkstreamId = item.organisationWorkstreamId == null ? null : safeId(item.organisationWorkstreamId);
    if (!id || !name || Boolean(clientWorkstreamId) === Boolean(organisationWorkstreamId)) return [];
    return [{ id, name, clientWorkstreamId, organisationWorkstreamId, canCreateTask: true }];
  }) : null;
  if (!targets || !groups) return null;
  return {
    taskCreationTargets: targets,
    groups,
    ...(typeof value.canReceiveAssignments === "boolean" ? { canReceiveAssignments: value.canReceiveAssignments } : {}),
  };
}

function safeCatalogSearchResult(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries) ||
      !value.permissions || (value.permissions.view !== true && value.permissions.manage !== true)) return null;
  const entries = value.entries.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = safeId(item.id);
    const title = safeText(item.title);
    const priority = ["low", "normal", "high", "urgent"].includes(item.priority) ? item.priority : null;
    const revision = Number.isSafeInteger(item.revision) && item.revision > 0 ? item.revision : null;
    const description = item.description == null ? null : safeText(item.description, 10000);
    if (!id || !title || !priority || !revision || (item.description != null && description === null)) return [];
    return [{ id, title, description, priority, revision }];
  });
  return { entries, permissions: { view: value.permissions.view === true, manage: value.permissions.manage === true } };
}

function safeCorrectionSearchResult(value, targetOption) {
  if (!value || typeof value !== "object" || !Array.isArray(value.tasks)) return null;
  const tasks = value.tasks.flatMap((item) => {
    if (!item || typeof item !== "object" || !["approved", "done"].includes(item.status) || item.isCorrection !== false) return [];
    const id = safeId(item.id);
    const title = safeText(item.title);
    const workstream = item.workstream;
    const workstreamId = workstream && typeof workstream === "object" ? safeId(workstream.id) : null;
    const workstreamKind = workstream?.kind;
    if (!id || !title || workstreamId !== targetOption.id || workstreamKind !== targetOption.kind) return [];
    return [{ id, title, status: item.status, isCorrection: false, workstream: { id: workstreamId, kind: workstreamKind } }];
  });
  return {
    tasks,
    options: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      workstreamId: task.workstream.id,
      workstreamKind: task.workstream.kind,
    })),
  };
}

function safeDepartmentSearchResult(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.departments)) return null;
  const departments = value.departments.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = safeId(item.id);
    const name = safeText(item.name);
    return id && name ? [{ id, name }] : [];
  });
  return { departments };
}

function rememberWorkContext(cache, result) {
  const targetKey = (item) => `${item.kind}:${item.id}:${item.requiredGroupId || ""}`;
  rememberRows(cache.targets, result.taskCreationTargets, targetKey);
  rememberRows(cache.groups, result.groups, (item) => item.id);
}

function sameTarget(a, b) {
  return a?.id === b?.id && a?.kind === b?.kind && (a?.requiredGroupId || null) === (b?.requiredGroupId || null);
}

function sameWorkstream(a, b) {
  return a?.workstreamId === b?.id && a?.workstreamKind === b?.kind;
}

function mergeRows(base, cached, keyOf) {
  const rows = new Map();
  for (const row of Array.isArray(base) ? base : []) {
    const key = keyOf(row);
    if (key) rows.set(key, row);
  }
  for (const [key, row] of cached) rows.set(key, row);
  return [...rows.values()];
}

function mergeSearchCache(data, cache) {
  const baseContext = data.workContext && typeof data.workContext === "object" ? data.workContext : {};
  const baseCatalog = data.taskCatalog && typeof data.taskCatalog === "object" ? data.taskCatalog : {};
  const baseTasks = data.tasks && typeof data.tasks === "object" ? data.tasks : {};
  const baseDepartments = data.departments && typeof data.departments === "object" ? data.departments : {};
  const targetKey = (item) => `${item.kind}:${item.id}:${item.requiredGroupId || ""}`;
  return {
    workContext: {
      ...baseContext,
      taskCreationTargets: mergeRows(baseContext.taskCreationTargets, cache.targets, targetKey),
      groups: mergeRows(baseContext.groups, cache.groups, (item) => item.id),
    },
    taskCatalog: {
      ...baseCatalog,
      ...(cache.catalogPermissions ? { permissions: cache.catalogPermissions } : {}),
      entries: mergeRows(baseCatalog.entries, cache.catalog, (item) => item.id),
    },
    tasks: {
      ...baseTasks,
      tasks: mergeRows(baseTasks.tasks, cache.corrections, (item) => item.id),
    },
    departments: {
      ...baseDepartments,
      departments: mergeRows(baseDepartments.departments, cache.departments, (item) => item.id),
    },
  };
}
