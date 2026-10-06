import { projectAdminWorkContextCreation } from "../src/features/work-context/admin-projection.ts";

/**
 * Admin route adapter for client, workstream, and group creation.
 * The feature projector owns the safe option lists; this host adapter binds
 * its callbacks to the exact Admin snapshot and page/account lifetime.
 */
export function createAdminWorkContextCreationRoute({
  state,
  target,
  lifetime,
  identityEpoch,
  actorPersonId,
  isCurrentPageRequest,
  canShowAdminFeature,
  hasAdminPermission,
  hasAnyPermissionGrant,
  adminReadIssue,
  runProtectedCommand,
  adminCommandUiError,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canShowAdminFeature,
    hasAdminPermission,
    hasAnyPermissionGrant,
    adminReadIssue,
    runProtectedCommand,
    adminCommandUiError,
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

  function requireCurrent(data, message = "The Admin page or account changed. Refresh Admin before trying again.") {
    if (!isCurrent(data)) throw adminCommandUiError(message);
  }

  function createProps(data) {
    requireCurrent(data, "Admin changed while work-context controls were loading. Refresh and try again.");
    if (!canShowAdminFeature(data.actorGrants, "work")) {
      throw adminCommandUiError("Your current access no longer allows this work-context feature. Refresh Admin and try again.");
    }

    return projectAdminWorkContextCreation(data, {
      hasPermission: hasAdminPermission,
      hasAnyPermission: hasAnyPermissionGrant,
      readIssue: adminReadIssue,
      runCommand: (permission, permissionTarget, method, path, payload, successMessage) => {
        requireCurrent(data);
        return runProtectedCommand(
          (latest) => isCurrent(data, latest) && permission(latest),
          permissionTarget,
          method,
          path,
          payload,
          successMessage,
        );
      },
    });
  }

  return { createProps };
}

function currentActorPersonId(state) {
  return state.identityPersonId || state.actorGrants?.actorPersonId || state.adminData?.actorGrants?.actorPersonId || null;
}
