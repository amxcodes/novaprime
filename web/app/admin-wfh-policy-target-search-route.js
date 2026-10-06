const allowedKinds = new Set(["office", "organisation_department", "person"]);

function safeOptions(result) {
  if (!Array.isArray(result?.options) || result.options.length > 30) {
    throw new Error("The authorized WFH target response was invalid.");
  }
  const seen = new Set();
  const options = [];
  for (const option of result.options) {
    if (!option || typeof option.id !== "string" || !option.id.trim() ||
        typeof option.label !== "string" || !option.label.trim() || seen.has(option.id)) {
      throw new Error("The authorized WFH target response was invalid.");
    }
    seen.add(option.id);
    options.push({ value: option.id, label: option.label });
  }
  return options;
}

/** Server search adapter for WFH target choices; no Admin roster arrays are read or filtered. */
export function createWfhPolicyTargetSearchRoute({
  state,
  target,
  lifetime,
  isCurrentPageRequest,
  canShowAdminFeature,
  hasPermissionGrant,
  canViewAdminPeople,
  pageApi,
  captureCommandContext,
  isCurrentCommand,
  isCurrentCommandIdentity,
  errorText,
  adminCommandUiError,
  recoverProtectedCommandFailure,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canShowAdminFeature,
    hasPermissionGrant,
    canViewAdminPeople,
    pageApi,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    errorText,
    adminCommandUiError,
    recoverProtectedCommandFailure,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  function isAuthorized(data, kind) {
    const grants = data?.actorGrants;
    if (!data || !canShowAdminFeature(grants, "wfhOverrides") ||
        !hasPermissionGrant(grants, "availability.wfh_policy.manage")) return false;
    if (kind === "person") return canViewAdminPeople(grants);
    return hasPermissionGrant(grants, "organisation.settings.manage");
  }

  async function searchTargets(kind, query) {
    if (!allowedKinds.has(kind) || typeof query !== "string" || query.length > 100) {
      throw adminCommandUiError("The WFH target search is invalid.");
    }
    const snapshot = state.adminData;
    if (!target.isConnected || !isCurrentPageRequest(lifetime) || !isAuthorized(snapshot, kind)) {
      throw adminCommandUiError("Your WFH target access changed. Refresh Admin and try again.");
    }
    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) throw adminCommandUiError("The Admin page changed before target search could start.");
    const params = new URLSearchParams({ kind, q: query });
    try {
      const result = await pageApi(`/api/availability/wfh-policy-targets?${params.toString()}`, lifetime);
      if (!target.isConnected || !isCurrentPageRequest(lifetime) || !isCurrentCommand(context) ||
          state.adminData !== snapshot || !isAuthorized(state.adminData, kind)) {
        throw adminCommandUiError("Your WFH target access changed while searching. Refresh Admin and try again.");
      }
      return safeOptions(result);
    } catch (error) {
      if (error?.uiMessage === true) throw error;
      if (error?.httpStatus === 401 || error?.httpStatus === 403) {
        if (!isCurrentCommandIdentity(context)) throw adminCommandUiError("Your session changed. Sign in again before continuing.");
        recoverProtectedCommandFailure(error, context);
        throw adminCommandUiError("Your WFH target access changed. Refresh Admin and try again.");
      }
      if (!isCurrentCommandIdentity(context)) throw adminCommandUiError("Your session changed. Sign in again before continuing.");
      throw adminCommandUiError(errorText(error) || "WFH target options could not be loaded. Edit the search to try again.");
    }
  }

  return { searchTargets };
}
