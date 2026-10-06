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
  searchWorkContext,
  adminCommandUiError,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canShowAdminFeature,
    hasAdminPermission,
    hasAnyPermissionGrant,
    adminReadIssue,
    runProtectedCommand,
    searchWorkContext,
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

    const dependencies = {
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
    };
    const projected = projectAdminWorkContextCreation(data, dependencies);

    async function searchOptions(query, kind) {
      requireCurrent(data, "The Admin page or account changed before work-context search. Refresh Admin and try again.");
      let result;
      try {
        result = await searchWorkContext(query);
      } catch (error) {
        if (!isCurrent(data)) {
          throw adminCommandUiError("The Admin page or account changed during work-context search. Refresh Admin and try again.");
        }
        throw adminCommandUiError(error?.uiMessage ? error.message : "Authorized work-context choices could not be loaded. Try again.");
      }
      requireCurrent(data, "The Admin page or account changed during work-context search. Refresh Admin and try again.");
      const issue = adminReadIssue(result, "work-context search");
      if (issue || !result || typeof result !== "object" || Array.isArray(result) || result.error || result.readError) {
        throw adminCommandUiError(issue?.message || "Authorized work-context choices could not be loaded. Try again.");
      }

      const searchSnapshot = { ...data, workContext: normalizeWorkContextSearchResult(result) };
      const choices = projectAdminWorkContextCreation(searchSnapshot, dependencies);
      return kind === "clients"
        ? choices.clientOptions.map((option) => ({ value: option.id, label: option.name }))
        : choices.groupWorkstreamOptions.map((option) => ({
          value: `${option.kind}:${option.id}`,
          label: `${option.kind === "client" ? "Client" : "Organisation"} · ${option.name}`,
        }));
    }

    return {
      ...projected,
      onSearchClients: (query) => searchOptions(query, "clients"),
      onSearchGroupWorkstreams: (query) => searchOptions(query, "groups"),
    };
  }

  return { createProps };
}

function normalizeWorkContextSearchResult(result) {
  const string = (value) => typeof value === "string" ? value : "";
  const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
  return {
    clients: rows(result.clients).map((row) => ({ id: string(row.id), name: string(row.name) })),
    clientWorkstreams: rows(result.clientWorkstreams).map((row) => ({
      id: string(row.id),
      clientId: string(row.clientId ?? row.client_id),
      clientName: string(row.clientName ?? row.client_name),
      name: string(row.name),
    })),
    organisationWorkstreams: rows(result.organisationWorkstreams).map((row) => ({ id: string(row.id), name: string(row.name) })),
  };
}

function currentActorPersonId(state) {
  return state.identityPersonId || state.actorGrants?.actorPersonId || state.adminData?.actorGrants?.actorPersonId || null;
}
