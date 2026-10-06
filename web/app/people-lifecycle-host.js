import { createPersonLifecycleRoute } from "./people-lifecycle-route.js";
import { planPersonLifecycleCapabilities } from "../src/features/people/lifecycle-capabilities.ts";

/**
 * Compose one record's visible lifecycle actions from its current scoped read
 * grants and the route host's authenticated lifecycle callbacks.
 */
export function createPersonLifecycleActions({
  requestedPersonId,
  person,
  actorGrants,
  getActorGrants = () => actorGrants,
  ...routeDependencies
} = {}) {
  if (!person || person.id !== requestedPersonId) return undefined;
  const capabilities = planPersonLifecycleCapabilities(actorGrants, person);
  if (!Object.values(capabilities).some(Boolean)) return undefined;

  const route = createPersonLifecycleRoute({
    requestedPersonId,
    person,
    ...routeDependencies,
    canRun: (capabilityKey, currentPerson) =>
      planPersonLifecycleCapabilities(getActorGrants(), currentPerson)[capabilityKey] === true,
  });
  return Object.freeze({ ...capabilities, ...route });
}

/** Bind the feature route to the current app session and page primitives. */
export function createPeopleLifecyclePageActionProvider({
  requestedPersonId,
  lifetime,
  pageRoot,
  getActorGrants,
  getIdentityEpoch,
  getActorPersonId,
  isCurrentPageRequest,
  hasPermissionGrant,
  api,
  requestOptions,
  pageApi,
  captureCommandContext,
  isCurrentCommand,
  recoverProtectedCommandFailure,
  refreshActorPermissions,
  setMessage,
  render,
  mapError,
} = {}) {
  let cachedPersonId = null;
  let cachedActions = null;

  return (person) => {
    if (!person || person.id !== requestedPersonId) return undefined;
    if (cachedPersonId === person.id) return cachedActions;
    cachedPersonId = person.id;
    cachedActions = createPersonLifecycleActions({
      requestedPersonId,
      person,
      actorGrants: getActorGrants(),
      getActorGrants,
      isCurrent: () => isCurrentPageRequest(lifetime) && pageRoot.isConnected,
      hasPermission: (permission, target) => hasPermissionGrant(getActorGrants(), permission, target),
      submit: (path, payload) => api(path, requestOptions("POST", payload)),
      readPerson: async (id) => {
        const current = await pageApi("/api/people/" + encodeURIComponent(id), lifetime);
        return current.person || null;
      },
      captureContext: () => captureCommandContext(pageRoot),
      isContextCurrent: isCurrentCommand,
      recoverProtectedFailure: (error, context, message) =>
        recoverProtectedCommandFailure(error, context, message),
      refreshAccess: (message) => {
        const identityEpoch = getIdentityEpoch();
        const actorPersonId = getActorPersonId();
        if (actorPersonId) refreshActorPermissions(identityEpoch, actorPersonId, message);
        else if (isCurrentPageRequest(lifetime)) {
          setMessage(message, "error");
          render();
        }
      },
      onSuccess: (message) => {
        setMessage(message);
        render();
      },
      mapError,
    });
    return cachedActions;
  };
}
