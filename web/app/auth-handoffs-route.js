const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reads only the server-issued organisation grants needed for this feature. */
export function getAuthHandoffAccess(state) {
  const email = String(state.session?.email || "").trim().toLowerCase();
  const bootstrap = Boolean(state.bootstrapToken) && state.session?.emailVerified === false &&
    state.actorGrants?.readError === "ACCOUNT_NOT_OPERATIONAL" && Boolean(email) &&
    email === state.bootstrapFounderEmail;
  if (bootstrap) return { bootstrap: true, canRead: true, allowedPurposes: ["verification"] };

  const hasOrganisationPermission = (permissionKey) => !state.actorGrants?.readError &&
    Array.isArray(state.actorGrants?.grants) && state.actorGrants.grants.some((grant) =>
      grant?.permissionKey === permissionKey && grant.scope === "organisation",
    );
  const canInvite = hasOrganisationPermission("people.invite");
  const canRecover = hasOrganisationPermission("auth.manual_recovery");
  const allowedPurposes = [
    ...(canInvite ? ["invitation"] : []),
    ...(canRecover ? ["verification", "password_reset"] : []),
  ];
  return { bootstrap: false, canRead: canInvite || canRecover, allowedPurposes };
}

/** Settings adapter: keeps credentials, IDs, one-time URLs, and stale-result guards in the host. */
export async function mountSettingsAuthHandoffs(target, isCurrentSettings, host) {
  const { state } = host;
  const identityEpoch = state.identityEpoch;
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/admin/auth-handoffs/index.ts")))();
  } catch {
    if (identityEpoch === state.identityEpoch && isCurrentSettings() && target.isConnected) {
      target.replaceChildren(host.noticeElement("Secure handoffs could not load. Reload Settings to try again.", "error"));
    }
    return;
  }

  let readState = { status: "loading" };
  let readGeneration = 0;
  let pendingRevealCount = 0;
  const attemptedHandoffIds = new Set();
  const isCurrentPage = () => identityEpoch === state.identityEpoch && isCurrentSettings() && target.isConnected;
  const isCurrent = () => isCurrentPage() && getAuthHandoffAccess(state).canRead;
  const publish = (allowCompletedBootstrapReveal = false) => {
    const access = getAuthHandoffAccess(state);
    if (!isCurrentPage() || (!access.canRead && !allowCompletedBootstrapReveal)) return;
    host.mountReactIsland(target, feature.AuthHandoffs, {
      readState,
      canRead: access.canRead,
      revealPending: pendingRevealCount > 0,
      onRetry: () => refresh(),
    });
  };

  async function refresh() {
    if (!isCurrent() || pendingRevealCount > 0) return;
    const generation = ++readGeneration;
    const context = host.captureCommandContext(target);
    readState = { status: "loading" };
    publish();
    const access = getAuthHandoffAccess(state);
    try {
      const result = await host.api("/api/auth-handoffs", access.bootstrap
        ? host.requestOptions("GET", undefined, { "x-nova-bootstrap-token": state.bootstrapToken })
        : host.requestOptions("GET"));
      if (!isCurrent() || generation !== readGeneration || !host.isCurrentCommand(context)) return;
      if (!Array.isArray(result?.handoffs)) throw new Error("AUTH_HANDOFF_RESPONSE_INVALID");
      const visibleRows = result.handoffs.filter((entry) => {
        if (!entry || !access.allowedPurposes.includes(entry.purpose)) return false;
        if (typeof entry.id !== "string" || !uuidPattern.test(entry.id)) throw new Error("AUTH_HANDOFF_RESPONSE_INVALID");
        return true;
      });
      const snapshot = feature.projectAuthHandoffList(
        { handoffs: visibleRows },
        access.allowedPurposes,
        (id, purpose) => async () => reveal(id, purpose, generation),
        (id) => attemptedHandoffIds.has(id),
      );
      if (!snapshot) throw new Error("AUTH_HANDOFF_RESPONSE_INVALID");
      readState = { status: "ready", handoffs: snapshot };
    } catch (error) {
      if (!isCurrent() || generation !== readGeneration) return;
      if (host.isCurrentCommandIdentity(context) && host.recoverProtectedCommandFailure(
        error,
        context,
        "Your secure handoff access changed. Settings is refreshing your permissions.",
      )) return;
      if (!host.isCurrentCommand(context)) return;
      readState = {
        status: "error",
        message: error?.httpStatus >= 500
          ? "Secure handoffs are temporarily unavailable. Try again shortly."
          : "Secure handoffs could not be loaded. Refresh the list and try again.",
      };
    }
    publish();
  }

  async function reveal(id, purpose, sourceGeneration) {
    const context = host.captureCommandContext(target);
    const access = getAuthHandoffAccess(state);
    if (pendingRevealCount > 0 || sourceGeneration !== readGeneration || !uuidPattern.test(id) ||
      !host.isCurrentCommand(context) || !access.allowedPurposes.includes(purpose) || attemptedHandoffIds.has(id)) {
      throw new feature.AuthHandoffActionError("rejected", "This handoff is no longer available. Refresh the handoff list before continuing.");
    }
    attemptedHandoffIds.add(id);
    const bootstrap = access.bootstrap;
    const bootstrapToken = bootstrap ? state.bootstrapToken : "";
    let confirmedBootstrapReveal = false;
    pendingRevealCount += 1;
    publish();
    try {
      const result = await host.api("/api/auth-handoffs/" + encodeURIComponent(id) + "/reveal", host.requestOptions(
        "POST",
        undefined,
        bootstrap ? { "x-nova-bootstrap-token": bootstrapToken } : undefined,
      ));
      if (sourceGeneration !== readGeneration || !host.isCurrentCommand(context) ||
        !getAuthHandoffAccess(state).allowedPurposes.includes(purpose)) {
        throw new feature.AuthHandoffActionError("unconfirmed", "Settings or your access changed. The link was discarded; refresh the handoff list before continuing.");
      }
      const handoff = result?.handoff;
      const url = typeof handoff?.url === "string" ? handoff.url : "";
      let parsedUrl;
      try { parsedUrl = new URL(url); } catch { parsedUrl = null; }
      if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new feature.AuthHandoffActionError("unconfirmed", "NOVA returned an invalid link. Refresh the handoff list before continuing.");
      }
      confirmedBootstrapReveal = bootstrap;
      return url;
    } catch (error) {
      if (error instanceof feature.AuthHandoffActionError) throw error;
      if (!host.isCurrentCommandIdentity(context)) {
        throw new feature.AuthHandoffActionError("rejected", "Your account changed. Sign in again before continuing.");
      }
      const changedMessage = "Your secure handoff access changed. Settings is refreshing your permissions.";
      if (host.recoverProtectedCommandFailure(error, context, changedMessage)) {
        throw new feature.AuthHandoffActionError("rejected", changedMessage);
      }
      if (!host.isCurrentCommand(context)) {
        throw new feature.AuthHandoffActionError("unconfirmed", "Settings changed. The link was discarded; refresh the handoff list before continuing.");
      }
      throw new feature.AuthHandoffActionError(
        error?.httpStatus >= 500 || !Number.isInteger(error?.httpStatus) ? "unconfirmed" : "unavailable",
        error?.httpStatus >= 500 || !Number.isInteger(error?.httpStatus)
          ? "NOVA could not confirm whether the link was consumed. The reveal was not retried; refresh the handoff list before taking further action."
          : "This handoff is no longer available. Refresh the handoff list to check its current status.",
      );
    } finally {
      if (confirmedBootstrapReveal) {
        state.bootstrapToken = "";
        state.bootstrapFounderEmail = "";
      }
      pendingRevealCount = Math.max(0, pendingRevealCount - 1);
      publish(confirmedBootstrapReveal);
    }
  }

  publish();
  await refresh();
}
