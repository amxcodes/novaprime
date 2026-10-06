/**
 * Admin host adapter for the per-client membership feature. The route owns the
 * snapshot, current actor grants and authenticated transport; the feature's
 * controller owns its on-demand, paginated read and mutation state.
 */
export function createAdminClientMembershipsRoute({
  state,
  target,
  lifetime,
  identityEpoch,
  isCurrentPageRequest,
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
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
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
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  const mountedIdentityEpoch = identityEpoch ?? state.identityEpoch;

  function isCurrentAdminSnapshot(data) {
    return target.isConnected === true && isWithinApp(target) && isCurrentPageRequest(lifetime) &&
      state.identityEpoch === mountedIdentityEpoch && state.adminData === data;
  }

  function projectTargets(data) {
    if (!isCurrentAdminSnapshot(data)) return [];
    const clients = data.workContext?.clients;
    if (!Array.isArray(clients)) return [];
    return clients.flatMap((client) => {
      if (!client || typeof client.id !== "string" || !client.id ||
          typeof client.name !== "string" ||
          !hasAdminPermission(data, "clients.members.manage", { clientId: client.id })) return [];
      return [{ id: client.id, name: client.name }];
    });
  }

  function createProps(data, clientTarget, isClientTargetCurrent = () => true) {
    if (typeof isClientTargetCurrent !== "function") {
      throw new TypeError("isClientTargetCurrent must be a function");
    }
    if (!isCurrentAdminSnapshot(data)) {
      throw adminCommandUiError("The Admin page or account changed. Refresh Admin before opening client memberships.");
    }
    const clientId = typeof clientTarget === "string" ? clientTarget : clientTarget?.id;
    const client = Array.isArray(data.workContext?.clients)
      ? data.workContext.clients.find((row) => row?.id === clientId)
      : null;
    if (!client || !hasAdminPermission(data, "clients.members.manage", { clientId: client.id })) {
      throw adminCommandUiError("Your current access no longer allows membership management for this client.");
    }

    const clientProps = { id: client.id, name: client.name };
    const canViewMemberships = true;
    const canManageMemberships = true;
    // The People selector is a separately authorized organization roster.
    // Client membership grants do not imply people.view, and options are read
    // remotely for each query rather than filtering a preloaded organization list.
    const canSearchPeople = canViewAdminPeople(data.actorGrants);

    const isCurrent = () => isClientTargetCurrent() && isCurrentAdminSnapshot(data) &&
      hasAdminPermission(state.adminData, "clients.members.manage", { clientId: client.id });

    const readRequest = async (path) => {
      const context = captureCommandContext(target);
      try {
        return await pageApi(path, lifetime);
      } catch (error) {
        if (!isCurrentCommand(context)) return undefined;
        if (recoverProtectedCommandFailure(error, context)) return undefined;
        throw error;
      }
    };

    const searchOptions = async (kind, query) => {
      if (!isCurrent()) {
        throw adminCommandUiError("The Admin page or client membership access changed. Refresh Admin before searching.");
      }
      if (kind === "person" && !canViewAdminPeople(state.adminData?.actorGrants)) {
        throw adminCommandUiError("People search requires organization-level people viewing access.");
      }
      const normalized = typeof query === "string" ? query.trim() : "";
      if (normalized.length > 100) return [];
      const params = new URLSearchParams({ kind, q: normalized });
      const result = await readRequest(`/api/clients/${encodeURIComponent(client.id)}/membership-options?${params.toString()}`);
      if (!isCurrent()) return [];
      if (!Array.isArray(result?.options)) throw adminCommandUiError("The authorized selector response was invalid.");
      return result.options.flatMap((option) =>
        option && typeof option.id === "string" && typeof option.label === "string"
          ? [{ value: option.id, label: option.label }]
          : [],
      ).slice(0, 30);
    };

    return {
      client: clientProps,
      canViewMemberships,
      canManageMemberships,
      canSearchPeople,
      onSearchPeople: (query) => searchOptions("person", query),
      onSearchDepartments: (query) => searchOptions("department", query),
      request: async ({ method, path, body }) => {
        if (!isCurrent()) {
          throw adminCommandUiError("The Admin page or client membership access changed. Refresh Admin before continuing.");
        }
        if (method !== "GET") {
          if (!hasAdminPermission(state.adminData, "clients.members.manage", { clientId: client.id })) {
            throw adminCommandUiError("Your current access no longer allows membership changes for this client.");
          }
          return api(path, requestOptions(method, body));
        }
        return readRequest(path);
      },
      runCommand: async (command, successMessage) => {
        if (!isCurrent()) {
          throw adminCommandUiError("The Admin page or client membership access changed. Refresh Admin before continuing.");
        }
        const context = captureCommandContext(target);
        try {
          const result = await command();
          if (!isCurrentCommand(context) || !isCurrent()) return undefined;
          setMessage(successMessage);
          return result;
        } catch (error) {
          if (!isCurrentCommandIdentity(context)) return undefined;
          if (recoverProtectedCommandFailure(error, context)) return undefined;
          throw error;
        }
      },
      isCurrent,
      errorMessage: errorText,
    };
  }

  return { projectTargets, createProps };
}
