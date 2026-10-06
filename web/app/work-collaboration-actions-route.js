/** Bind collaboration resolution to host-owned transport and command lifetime. */
export function createWorkCollaborationResolveAction({ target, host } = {}) {
  const {
    getRequestForKind,
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    setMessage,
    refreshWork,
  } = host || {};
  const requiredServices = {
    getRequestForKind,
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    setMessage,
    refreshWork,
  };
  for (const [name, service] of Object.entries(requiredServices)) {
    if (typeof service !== "function") throw new TypeError(`Work collaboration action service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Work collaboration action target is required");
  const requestKinds = {
    reviewer: { endpoint: "/api/task-reviewer-requests/", label: "Reviewer request" },
    handover: { endpoint: "/api/task-handover-requests/", label: "Handover request" },
  };
  const decisionCapabilities = { accept: "canAccept", decline: "canDecline", withdraw: "canWithdraw" };

  return async function onResolve(kind, request, decision) {
    const requestKind = requestKinds[kind];
    const capability = decisionCapabilities[decision];
    if (!requestKind || !capability) throw new Error("This collaboration action is not supported.");
    const rawRequest = getRequestForKind(kind, request.id);
    if (rawRequest?.status !== "pending" || rawRequest[capability] !== true) {
      throw new Error("This collaboration action is no longer available.");
    }
    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) throw new Error("The Work page changed before this action could start.");
    try {
      await api(requestKind.endpoint + encodeURIComponent(request.id) + "/" + decision, requestOptions("POST", {}));
    } catch (error) {
      if (!isCurrentCommandIdentity(context)) throw new Error("Your session changed. Sign in again before continuing.");
      const message = "Your collaboration access changed. Available actions have been refreshed.";
      if (recoverProtectedCommandFailure(error, context, message)) throw new Error(message);
      if (!isCurrentCommand(context)) throw new Error("The Work page changed before this action completed.");
      throw error;
    }
    if (!isCurrentCommand(context)) throw new Error("The Work page changed before this action completed.");
    setMessage(`${requestKind.label} ${decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "withdrawn"}.`);
    refreshWork();
  };
}
