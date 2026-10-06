import { createElement } from "react";

/**
 * Compose Admin Work's independent feature children after the route has planned
 * reads and authorized chunks. Transport, current grants, and server commands
 * remain injected from the application host.
 */
export function createAdminWorkComposition({
  data,
  state,
  target,
  lifetime,
  identityEpoch,
  revision,
  modules,
  fallback,
  host,
}) {
  const {
    AdminWorkSection,
    AdminWorkFeatureFailure,
    WorkContextCreation,
    TaskComposer,
    WorkOperations,
    AdminClientMembershipTargets,
    AdminClientMembershipEditor,
  } = modules;
  const {
    adminWorkContextCreationRoute,
    adminTaskComposerRoute,
    adminWorkOperationsRoute,
    adminClientMembershipsRoute,
  } = modules;
  const {
    canShowAdminFeature,
    hasAdminPermission,
    hasAnyPermissionGrant,
    planAdminReads,
    isCurrentPageRequest,
    adminReadIssue,
    adminFeatureReadError,
    adminCommandUiError,
    runAdminProtectedCommand,
    pageApi,
    requestOptions,
    errorText,
    setMessage,
    taskCreateIdempotencyHeaders,
    clearTaskCreateIdempotency,
    taskBillingConfirmation,
    taskCorrectionConfirmation,
    projectTaskComposerOptions,
    canViewAdminPeople,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    api,
    isWithinApp,
  } = host;

  if (!canShowAdminFeature(data.actorGrants, "work")) return null;
  if (typeof AdminWorkSection !== "function") return createElement(fallback);

  const featureFailure = (title, message) => typeof AdminWorkFeatureFailure === "function"
    ? createElement(AdminWorkFeatureFailure, { title, message })
    : createElement("section", { role: "alert", "aria-label": title }, message);
  const routeCommand = (permission, permissionTarget, method, path, payload, successMessage, afterSuccess, headers) =>
    runAdminProtectedCommand(
      target, lifetime, permission, permissionTarget, method, path, payload, successMessage, afterSuccess, headers,
    );

  const contextCreationVisible = hasAnyPermissionGrant(data.actorGrants,
    ["clients.create", "workstreams.create", "groups.create"], ["organisation", "client", "client_workstream"]);
  let contextCreation = null;
  if (contextCreationVisible) {
    if (typeof WorkContextCreation !== "function" || typeof adminWorkContextCreationRoute !== "function") {
      contextCreation = featureFailure("Context setup", "Work context controls could not load. Reload Admin to try again.");
    } else {
      const route = adminWorkContextCreationRoute({
        state, target, lifetime, identityEpoch,
        actorPersonId: state.identityPersonId || data.actorGrants?.actorPersonId || null,
        isCurrentPageRequest,
        canShowAdminFeature,
        hasAdminPermission,
        hasAnyPermissionGrant,
        adminReadIssue,
        runProtectedCommand: routeCommand,
        adminCommandUiError,
      });
      contextCreation = createElement(WorkContextCreation, route.createProps(data));
    }
  }

  const taskCreationVisible = hasAnyPermissionGrant(data.actorGrants,
    ["tasks.create"], ["organisation", "client", "client_workstream", "group"]);
  let taskComposer = null;
  if (taskCreationVisible) {
    if (typeof TaskComposer !== "function" || typeof adminTaskComposerRoute !== "function") {
      taskComposer = featureFailure("Create task", "Task creation could not load. Reload Admin to try again.");
    } else {
      const route = adminTaskComposerRoute({
        state, target, lifetime, identityEpoch,
        actorPersonId: state.identityPersonId || data.actorGrants?.actorPersonId || null,
        isCurrentPageRequest,
        canShowAdminFeature,
        hasAnyPermissionGrant,
        planAdminReads,
        projectTaskComposerOptions,
        runProtectedCommand: routeCommand,
        adminCommandUiError,
        taskCreateIdempotencyHeaders,
        clearTaskCreateIdempotency,
        setMessage,
        taskBillingConfirmation,
        taskCorrectionConfirmation,
      });
      taskComposer = createElement(TaskComposer, route.createProps(data));
    }
  }

  const readPlan = planAdminReads(data.actorGrants);
  let taskOperations = null;
  if (readPlan.tasks) {
    if (typeof WorkOperations !== "function" || typeof adminWorkOperationsRoute !== "function") {
      taskOperations = featureFailure("Tasks and assignments", "Task operations could not load. Reload Admin to try again.");
    } else {
      const route = adminWorkOperationsRoute({
        state, target, lifetime, identityEpoch, isCurrentPageRequest,
        hasAdminPermission,
        pageApi,
        runAdminProtectedCommand,
        requestOptions,
        errorText,
        adminCommandUiError,
        setMessage,
      });
      taskOperations = createElement(WorkOperations, route.createProps(data));
    }
  }

  const membershipVisible = hasAnyPermissionGrant(data.actorGrants,
    ["clients.members.manage"], ["organisation", "client"]);
  let membershipTargets = null;
  if (membershipVisible) {
    if (typeof AdminClientMembershipTargets !== "function" ||
        typeof AdminClientMembershipEditor !== "function" ||
        typeof adminClientMembershipsRoute !== "function") {
      membershipTargets = featureFailure("Client memberships", "Client membership controls could not load. Reload Admin to try again.");
    } else {
      const route = adminClientMembershipsRoute({
        state, target, lifetime, identityEpoch, isCurrentPageRequest,
        isWithinApp,
        hasAdminPermission,
        canViewAdminPeople,
        captureCommandContext,
        isCurrentCommand,
        isCurrentCommandIdentity,
        recoverProtectedCommandFailure,
        api,
        pageApi,
        requestOptions,
        errorText,
        adminCommandUiError,
        setMessage,
      });
      const readIssue = adminFeatureReadError(data.workContext, "authorized client targets");
      const targets = readIssue || data.workContext?.readState === "not-requested"
        ? { status: readIssue?.status || "unavailable", message: readIssue?.message || "Authorized client targets were not requested for this access." }
        : { status: "ready", targets: route.projectTargets(data) };
      membershipTargets = createElement(AdminClientMembershipTargets, {
        targets,
        renderMemberships: (client, isClientTargetCurrent) => createElement(
          AdminClientMembershipEditor,
          route.createProps(data, client, isClientTargetCurrent),
        ),
      });
    }
  }

  return createElement(AdminWorkSection, {
    key: `admin-work-${identityEpoch}-${revision}`,
    contextCreation,
    taskComposer,
    taskOperations,
    membershipTargets,
  });
}
