const officePurposes = new Set(["calendar", "holiday"]);

function safeOptions(result) {
  if (!Array.isArray(result?.options) || result.options.length > 30) {
    throw new Error("The authorized availability target response was invalid.");
  }
  const seen = new Set();
  const options = [];
  for (const option of result.options) {
    if (!option || typeof option.id !== "string" || !option.id.trim() ||
        typeof option.label !== "string" || !option.label.trim() || seen.has(option.id)) {
      throw new Error("The authorized availability target response was invalid.");
    }
    seen.add(option.id);
    options.push({ value: option.id, label: option.label });
  }
  return options;
}

/** Small target adapter for calendar and holiday forms; target rows are fetched only for the live query. */
export function createAvailabilityPickerSearchRoute({
  state,
  target,
  lifetime,
  isCurrentPageRequest,
  hasPermissionGrant,
  pageApi,
  captureCommandContext,
  isCurrentCommand,
  isCurrentCommandIdentity,
  recoverProtectedCommandFailure,
  errorText,
  adminCommandUiError,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    hasPermissionGrant,
    pageApi,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    errorText,
    adminCommandUiError,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  function isOfficeAuthorized(data, purpose) {
    const grants = data?.actorGrants;
    const featurePermission = purpose === "calendar" ? "availability.calendar.manage" : "availability.holiday.manage";
    return hasPermissionGrant(grants, "organisation.settings.manage") && hasPermissionGrant(grants, featurePermission);
  }

  function isShiftAuthorized(data) {
    return hasPermissionGrant(data?.actorGrants, "availability.calendar.manage");
  }

  async function search(kind, purpose, query) {
    if (typeof query !== "string" || query.length > 100 ||
        (kind === "office" && !officePurposes.has(purpose)) ||
        (kind === "shift" && purpose !== "calendar") || (kind !== "office" && kind !== "shift")) {
      throw adminCommandUiError("The availability target search is invalid.");
    }
    const snapshot = state.adminData;
    const authorized = kind === "office" ? isOfficeAuthorized(snapshot, purpose) : isShiftAuthorized(snapshot);
    if (!target.isConnected || !isCurrentPageRequest(lifetime) || !authorized) {
      throw adminCommandUiError("Your availability target access changed. Refresh Admin and try again.");
    }
    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) throw adminCommandUiError("The Admin page changed before target search could start.");
    const params = new URLSearchParams({ kind, purpose, q: query });
    try {
      const result = await pageApi(`/api/availability/configuration-targets?${params.toString()}`, lifetime);
      const currentAuthorized = kind === "office"
        ? isOfficeAuthorized(state.adminData, purpose)
        : isShiftAuthorized(state.adminData);
      if (!target.isConnected || !isCurrentPageRequest(lifetime) || !isCurrentCommand(context) ||
          state.adminData !== snapshot || !currentAuthorized) {
        throw adminCommandUiError("Your availability target access changed while searching. Refresh Admin and try again.");
      }
      return safeOptions(result);
    } catch (error) {
      if (error?.uiMessage === true) throw error;
      if (!isCurrentCommandIdentity(context)) throw adminCommandUiError("Your session changed. Sign in again before continuing.");
      if (error?.httpStatus === 401 || error?.httpStatus === 403) {
        recoverProtectedCommandFailure(error, context);
        throw adminCommandUiError("Your availability target access changed. Refresh Admin and try again.");
      }
      throw adminCommandUiError(errorText(error) || "Availability target options could not be loaded. Edit the search to try again.");
    }
  }

  return {
    searchOffices: (purpose, query) => search("office", purpose, query),
    searchShifts: (query) => search("shift", "calendar", query),
  };
}
