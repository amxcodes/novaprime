const ACTIONS = Object.freeze({
  freeze: Object.freeze({
    key: "freeze",
    capability: "canFreeze",
    permission: "people.freeze",
    pathSuffix: "/freeze",
    successMessage: "Person frozen and existing sessions revoked.",
  }),
  startOffboarding: Object.freeze({
    key: "startOffboarding",
    capability: "canStartOffboarding",
    permission: "people.offboard",
    pathSuffix: "/offboard",
    successMessage: "Offboarding started. Reassignments and review handover remain audited.",
  }),
  completeExit: Object.freeze({
    key: "completeExit",
    capability: "canCompleteOffboarding",
    permission: "people.offboard",
    pathSuffix: "/offboard",
    successMessage: "Exit completed; history was preserved.",
  }),
});

const STALE_MESSAGE = "This person record changed before the action finished. Refresh and try again.";
const ACCESS_CHANGED_MESSAGE = "This person's status or your access changed. Refresh the person record and check the available actions.";

/**
 * Bind existing lifecycle POSTs to one exact, currently readable person. The
 * host supplies effective grants, authenticated transport, and identity guards.
 */
export function createPersonLifecycleRoute({
  requestedPersonId,
  person,
  isCurrent,
  hasPermission,
  submit,
  readPerson,
  canRun,
  captureContext,
  isContextCurrent,
  recoverProtectedFailure,
  refreshAccess = () => {},
  onSuccess = () => {},
  mapError = () => "The action could not be completed. Refresh this person record and try again.",
} = {}) {
  for (const [name, callback] of Object.entries({
    isCurrent,
    hasPermission,
    submit,
    readPerson,
    canRun,
    captureContext,
    isContextCurrent,
    recoverProtectedFailure,
  })) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }

  const matchingPerson = person && typeof person.id === "string" &&
    person.id === requestedPersonId && typeof requestedPersonId === "string" && requestedPersonId.length > 0;
  // Bind the controller to the actor and page that mounted this record. A
  // stale component must never adopt a later identity by capturing on click.
  const routeContext = captureContext();
  let inFlight = false;

  async function run(action, reason = "") {
    if (!matchingPerson || !isCurrent() || !isContextCurrent(routeContext)) {
      return { status: "error", message: STALE_MESSAGE };
    }
    if (inFlight) return { status: "error", message: "Another lifecycle action is already in progress." };

    inFlight = true;
    try {
      const current = await readPerson(person.id, routeContext);
      if (!isCurrent() || !isContextCurrent(routeContext)) {
        return { status: "error", message: STALE_MESSAGE };
      }
      if (!current || current.id !== person.id || !canRun(action.capability, current)) {
        safelyRefreshAccess();
        return { status: "error", message: ACCESS_CHANGED_MESSAGE };
      }
      const currentTarget = {
        personId: current.id,
        officeId: current.office?.id,
        organisationDepartmentId: current.department?.id,
      };
      if (!hasPermission(action.permission, currentTarget)) {
        safelyRefreshAccess();
        return { status: "error", message: ACCESS_CHANGED_MESSAGE };
      }

      const payload = action === ACTIONS.freeze
        ? { reason: "Frozen by administrator" }
        : action === ACTIONS.completeExit
          ? { final: true, reason }
          : { reason };
      const path = `/api/people/${encodeURIComponent(person.id)}${action.pathSuffix}`;
      await submit(path, payload);
    } catch (error) {
      if (!isCurrent() || !isContextCurrent(routeContext)) return { status: "error", message: STALE_MESSAGE };
      if (safelyRecoverProtectedFailure(error)) {
        return { status: "error", message: ACCESS_CHANGED_MESSAGE };
      }
      return { status: "error", message: safeErrorMessage(error) };
    } finally {
      inFlight = false;
    }

    if (!isCurrent() || !isContextCurrent(routeContext)) return { status: "error", message: STALE_MESSAGE };
    try {
      const effect = onSuccess(action.successMessage, person.id);
      if (effect && typeof effect.catch === "function") void effect.catch(() => {});
    } catch {
      // The server confirmed the write; a refresh/feedback effect cannot turn
      // that committed command into a retryable-looking failure.
    }
    return { status: "success", message: action.successMessage };
  }

  function safeErrorMessage(error) {
    try {
      const message = mapError(error);
      return typeof message === "string" && message.trim()
        ? message
        : "The action could not be completed. Refresh this person record and try again.";
    } catch {
      return "The action could not be completed. Refresh this person record and try again.";
    }
  }

  function safelyRefreshAccess() {
    try {
      refreshAccess(ACCESS_CHANGED_MESSAGE);
    } catch {
      // The action remains blocked even if host-side refresh cannot start.
    }
  }

  function safelyRecoverProtectedFailure(error) {
    try {
      return recoverProtectedFailure(error, routeContext, ACCESS_CHANGED_MESSAGE) === true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    onFreeze: () => run(ACTIONS.freeze),
    onStartOffboarding: (reason) => run(ACTIONS.startOffboarding, reason),
    onCompleteExit: (reason) => run(ACTIONS.completeExit, reason),
  });
}

export const personLifecycleRouteMessages = Object.freeze({
  stale: STALE_MESSAGE,
  accessChanged: ACCESS_CHANGED_MESSAGE,
});
