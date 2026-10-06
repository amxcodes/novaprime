/**
 * Settings host adapter for Public Origin. The caller owns permission gating,
 * transport, bootstrap credentials, shared snapshot state, and page identity.
 * Only the projected origin state and callbacks reach the feature.
 */
export async function mountSettingsPublicOriginRoute({
  target,
  isCurrentSettings,
  originBridge,
  host,
} = {}) {
  const {
    getIdentityEpoch,
    loadFeature = () => import("../src/features/settings/public-origin/index.ts"),
    readOrigin,
    saveOrigin,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    publishOriginSnapshot,
    clearOriginSnapshot,
    mountReactIsland,
    noticeElement,
    errorText,
  } = host || {};
  const requiredServices = {
    getIdentityEpoch,
    isCurrentSettings,
    readOrigin,
    saveOrigin,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    publishOriginSnapshot,
    clearOriginSnapshot,
    mountReactIsland,
    noticeElement,
    errorText,
  };
  for (const [name, service] of Object.entries(requiredServices)) {
    if (typeof service !== "function") throw new TypeError(`Public Origin route service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Public Origin route target is required");
  if (!originBridge || typeof originBridge.publish !== "function") {
    throw new TypeError("Public Origin route bridge is required");
  }

  const identityEpoch = getIdentityEpoch();
  let feature;
  try {
    feature = await loadFeature();
  } catch {
    const message = "Public origin settings could not load. Reload Settings to try again.";
    originBridge.publish({ status: "error", message });
    if (isCurrentSettings() && target.isConnected) {
      target.replaceChildren(noticeElement(message, "error"));
    }
    return;
  }

  let readState = { status: "loading" };
  let readGeneration = 0;
  let saveInFlight = false;
  const isCurrent = () => identityEpoch === getIdentityEpoch() && isCurrentSettings() && target.isConnected;
  const publish = () => {
    if (!isCurrent()) return;
    originBridge.publish(readState);
    mountReactIsland(target, feature.PublicOrigin, {
      readState,
      onRetry: () => { void refresh(); },
      onSave: (origin) => save(origin),
    });
  };

  async function refresh() {
    if (!isCurrent()) return readState;
    const generation = ++readGeneration;
    const context = captureCommandContext(target);
    readState = { status: "loading" };
    publish();
    try {
      const result = await readOrigin();
      if (!isCurrent() || generation !== readGeneration) return readState;
      const snapshot = feature.projectPublicOrigin(result);
      if (!snapshot) throw new Error("PUBLIC_ORIGIN_RESPONSE_INVALID");
      publishOriginSnapshot(snapshot);
      readState = { status: "ready", ...snapshot };
    } catch (error) {
      if (!isCurrent() || generation !== readGeneration) return readState;
      if (isCurrentCommandIdentity(context) && recoverProtectedCommandFailure(
        error,
        context,
        "Public origin access changed. Refresh Settings to check the current permissions.",
      )) return readState;
      clearOriginSnapshot();
      readState = {
        status: "error",
        message: error?.code === "PERMISSION_DENIED"
          ? "Public origin settings are unavailable to this role."
          : errorText(error),
      };
    }
    publish();
    return readState;
  }

  async function save(origin) {
    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) {
      throw new feature.PublicOriginActionError("rejected", "Settings changed before this origin could be saved. Reload and try again.");
    }
    if (saveInFlight) return;
    saveInFlight = true;
    ++readGeneration;
    try {
      const result = await saveOrigin(origin);
      if (!isCurrentCommand(context)) {
        throw new feature.PublicOriginActionError("unconfirmed", "Settings changed before the save was confirmed. Refresh to check the current setting.");
      }
      const snapshot = feature.projectPublicOrigin(result);
      if (!snapshot) throw new Error("PUBLIC_ORIGIN_RESPONSE_INVALID");
      publishOriginSnapshot(snapshot);
      readState = { status: "ready", ...snapshot };
      publish();
    } catch (error) {
      if (error instanceof feature.PublicOriginActionError) throw error;
      if (!isCurrentCommandIdentity(context)) {
        throw new feature.PublicOriginActionError("rejected", "Your session changed. Sign in again before continuing.");
      }
      const changedMessage = "Public origin access changed while saving. Refresh Settings to check the current permissions.";
      if (recoverProtectedCommandFailure(error, context, changedMessage)) {
        throw new feature.PublicOriginActionError("rejected", changedMessage);
      }
      if (!isCurrentCommand(context)) {
        throw new feature.PublicOriginActionError("unconfirmed", "Settings changed before the save was confirmed. Refresh to check the current setting.");
      }

      const conflictCodes = [
        "PUBLIC_ORIGIN_CHANGE_BLOCKED_DURING_GMAIL_AUTH",
        "PUBLIC_ORIGIN_REQUIRED_WHILE_EMAIL_ACTIVE",
      ];
      if (!Number.isInteger(error?.httpStatus) || error.httpStatus >= 500) {
        saveInFlight = false;
        const refreshed = await refresh();
        throw new feature.PublicOriginActionError(
          "unconfirmed",
          refreshed?.status === "ready"
            ? "NOVA could not confirm the save response. The latest origin setting has been refreshed; review it before trying again."
            : "NOVA could not confirm the save response or check the latest origin. Retry the origin check before trying again.",
        );
      }
      throw new feature.PublicOriginActionError(
        conflictCodes.includes(error?.code) ? "conflict" : "rejected",
        errorText(error),
      );
    } finally {
      saveInFlight = false;
    }
  }

  originBridge.retry = () => { void refresh(); };
  publish();
  await refresh();
}
