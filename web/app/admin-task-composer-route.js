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
    const readPlan = planAdminReads(data.actorGrants);
    return projectTaskComposerOptions({
      canCreate: hasAnyPermissionGrant(data.actorGrants, ["tasks.create"], taskCreateScopes),
      workContextResult: data.workContext,
      catalogResult: data.taskCatalog,
      catalogRequested: readPlan.taskCatalog,
      correctionTasksResult: data.tasks,
      correctionsRequested: readPlan.tasks,
      departmentsResult: data.departments,
      departmentsRequested: readPlan.departments,
    });
  }

  function createProps(data) {
    requireCurrent(data, "Admin changed while task-creation controls were loading. Refresh and try again.");
    if (!canShowAdminFeature(data.actorGrants, "work")) {
      throw adminCommandUiError("Your current access no longer allows task creation. Refresh Admin to check access.");
    }
    return {
      ...projectOptions(data),
      heading: "Create task",
      description: "Choose an authorized workstream, then define the task. Assignment and review remain separate; NOVA applies billing automatically.",
      selfAssignmentDefault: false,
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
    const resolution = resolveTaskComposerSubmission(input, {
      composerOptions,
      workContextResult: current.workContext,
      catalogResult: current.taskCatalog,
      correctionTasksResult: current.tasks,
      departmentsResult: current.departments,
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
