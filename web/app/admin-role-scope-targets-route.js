const scopes = new Set(["office", "organisation_department", "client", "client_workstream", "group"]);

/** Roles feature adapter for the narrow, role-view-protected target directory. */
export function createAdminRoleScopeTargetsRoute({
  state,
  target,
  lifetime,
  identityEpoch,
  isCurrentPageRequest,
  hasAdminPermission,
  pageApi,
  captureCommandContext,
  isCurrentCommand,
  recoverProtectedCommandFailure,
  adminCommandUiError,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    hasAdminPermission,
    pageApi,
    captureCommandContext,
    isCurrentCommand,
    recoverProtectedCommandFailure,
    adminCommandUiError,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");
  const mountedIdentityEpoch = identityEpoch ?? state.identityEpoch;

  function isCurrentAdminSnapshot(data) {
    return target.isConnected === true && isCurrentPageRequest(lifetime) &&
      state.identityEpoch === mountedIdentityEpoch && state.adminData === data;
  }

  async function searchTargets(scope, query) {
    const data = state.adminData;
    if (!isCurrentAdminSnapshot(data)) {
      throw adminCommandUiError("The Admin page or account changed. Refresh Roles before searching scope targets.");
    }
    if (!hasAdminPermission(data, "roles.view")) {
      throw adminCommandUiError("Your current role-view access no longer allows scope target search.");
    }
    if (!scopes.has(scope)) throw adminCommandUiError("Choose a supported role scope before searching.");
    const normalized = typeof query === "string" ? query.trim() : "";
    if (normalized.length > 100) return [];
    const params = new URLSearchParams({ scope, q: normalized });
    const context = captureCommandContext(target);
    let result;
    try {
      result = await pageApi(`/api/roles/scope-targets?${params.toString()}`, lifetime);
    } catch (error) {
      if (!isCurrentCommand(context)) return [];
      if (recoverProtectedCommandFailure(error, context)) return [];
      throw error;
    }
    if (!isCurrentCommand(context) || !isCurrentAdminSnapshot(data) || state.adminData !== data) return [];
    if (!Array.isArray(result?.options)) {
      throw adminCommandUiError("The authorized scope target response was invalid.");
    }
    return result.options.flatMap((option) =>
      option && typeof option.id === "string" && typeof option.name === "string"
        ? [{ value: option.id, label: option.name }]
        : [],
    ).slice(0, 30);
  }

  return { searchTargets };
}
