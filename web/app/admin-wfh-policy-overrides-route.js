/**
 * Host adapter for Admin's WFH eligibility overrides feature.
 * Authenticated transport, effective grants, page/identity freshness and global feedback are injected by the route.
 */
export function createWfhPolicyOverridesRoute({
  state,
  target,
  lifetime,
  isCurrentPageRequest,
  canShowAdminFeature,
  hasPermissionGrant,
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
  adminReadIssue,
  setMessage,
  renderAdminContent,
  showFeedback,
  searchTargets,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canShowAdminFeature,
    hasPermissionGrant,
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
    adminReadIssue,
    setMessage,
    renderAdminContent,
    showFeedback,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  async function create(input, data) {
    const currentData = state.adminData;
    if (!target.isConnected || !isCurrentPageRequest(lifetime) || currentData !== data ||
        !canShowAdminFeature(currentData?.actorGrants, "wfhOverrides")) {
      throw adminCommandUiError("The Admin page changed before this override could be added. Refresh and try again.");
    }
    if (!hasPermissionGrant(currentData.actorGrants, "availability.wfh_policy.manage")) {
      throw adminCommandUiError("Your current access no longer allows WFH override management. Refresh Admin to check access.");
    }
    if ((input?.targetType === "office" || input?.targetType === "organisation_department") &&
        !hasPermissionGrant(currentData.actorGrants, "organisation.settings.manage")) {
      throw adminCommandUiError("Your current access no longer allows selecting this WFH target. Refresh Admin to check permissions.");
    }
    if (input?.targetType === "person" && !canViewAdminPeople(currentData.actorGrants)) {
      throw adminCommandUiError("Your current access no longer allows viewing this person. Refresh Admin to check permissions.");
    }
    if (typeof input?.targetId !== "string" || !input.targetId.trim()) {
      throw adminCommandUiError("Choose a WFH target before adding the override.");
    }

    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) {
      throw adminCommandUiError("The Admin page changed before this override could be added.");
    }
    try {
      await api("/api/availability/wfh-policies", requestOptions("POST", input));
    } catch (error) {
      if (!isCurrentCommandIdentity(context)) throw adminCommandUiError("Your session changed. Sign in again before continuing.");
      if (recoverProtectedCommandFailure(error, context)) {
        throw adminCommandUiError("Your access changed while adding the WFH override. Refresh Admin and check permissions.");
      }
      if (!isCurrentCommand(context) || state.adminData !== currentData) {
        throw adminCommandUiError("The Admin page changed before the override could be confirmed.");
      }
      throw adminCommandUiError(errorText(error));
    }
    if (!isCurrentCommand(context) || state.adminData !== currentData) return;

    let listRefreshFailed = false;
    const canReadCurrentPolicyList = canShowAdminFeature(state.adminData?.actorGrants, "wfhOverrides") &&
      hasPermissionGrant(state.adminData?.actorGrants, "availability.wfh_policy.view");
    if (canReadCurrentPolicyList) {
      try {
        const result = await pageApi("/api/availability/wfh-policies", lifetime);
        if (!isCurrentCommand(context) || state.adminData !== currentData) return;
        if (!Array.isArray(result?.policies)) {
          data.wfhPolicies = { policies: [], readError: "INVALID_RESPONSE" };
          listRefreshFailed = true;
        } else {
          data.wfhPolicies = { policies: result.policies };
        }
      } catch (error) {
        if (!isCurrentCommandIdentity(context)) return;
        listRefreshFailed = true;
        data.wfhPolicies = { policies: [], readError: error?.code || "REQUEST_FAILED" };
        if (error?.httpStatus === 401 || error?.httpStatus === 403) {
          setMessage("The WFH override was added, but the policy list could not refresh. Its latest state is unverified; reload Admin to verify it.", "warning");
          if (recoverProtectedCommandFailure(error, context)) {
            showFeedback();
            return;
          }
        }
        if (!isCurrentCommand(context) || state.adminData !== currentData) return;
      }
    }
    if (!isCurrentCommand(context) || state.adminData !== currentData) return;
    setMessage(listRefreshFailed
      ? "The WFH override was added, but the policy list could not refresh. Reload Admin to verify the latest list."
      : "WFH eligibility override added.", listRefreshFailed ? "warning" : "success");
    state.pendingAdminCommandFocus = true;
    await renderAdminContent(data, lifetime);
    showFeedback();
  }

  function createProps(data) {
    const currentGrantRead = state.adminData?.actorGrants;
    const canView = hasPermissionGrant(currentGrantRead, "availability.wfh_policy.view");
    const canManage = hasPermissionGrant(currentGrantRead, "availability.wfh_policy.manage");
    return {
      canView,
      canManage,
      policies: {
        result: data.wfhPolicies,
        authorized: canView,
        issue: adminReadIssue(data.wfhPolicies, "WFH eligibility overrides"),
      },
      targets: {
        office: {
          result: { readState: "remote" },
          authorized: hasPermissionGrant(currentGrantRead, "organisation.settings.manage"),
          issue: adminReadIssue(data.offices, "office override targets"),
        },
        organisation_department: {
          result: { readState: "remote" },
          authorized: hasPermissionGrant(currentGrantRead, "organisation.settings.manage"),
          issue: adminReadIssue(data.departments, "department override targets"),
        },
        person: {
          result: { readState: "remote" },
          authorized: canViewAdminPeople(currentGrantRead),
          issue: adminReadIssue(data.people, "person override targets"),
        },
      },
      onSearchTargets: searchTargets,
      onCreate: (input) => create(input, data),
    };
  }

  return { createProps };
}
