const deniedReadErrors = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);
const sessionStates = new Set(["running", "completed", "auto_closed", "cancelled"]);

function identityIsCurrent(identity) {
  return identity?.pageRequestCurrent === true &&
    typeof identity.requestActorId === "string" && identity.requestActorId.length > 0 &&
    identity.requestActorId === identity.currentActorId;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function projectSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const startedAt = parseTimestamp(value.startedAt);
  const endedAt = value.endedAt === null ? null : parseTimestamp(value.endedAt);
  const state = value.state;
  const durationMilliseconds = Number.isFinite(value.durationMilliseconds)
    ? Math.max(0, Math.floor(value.durationMilliseconds))
    : Number.isFinite(value.durationMicroseconds)
      ? Math.max(0, Math.floor(value.durationMicroseconds / 1000))
      : null;

  if (!id || !startedAt || (value.endedAt !== null && !endedAt) ||
      !sessionStates.has(state) || (state === "running") !== (endedAt === null) ||
      durationMilliseconds === null) {
    return null;
  }

  return {
    id,
    title: typeof value.title === "string" && value.title.trim()
      ? value.title.trim().slice(0, 500)
      : "Untitled assignment",
    startedAt,
    endedAt,
    state,
    closureReason: value.closureReason === "PAUSED" || value.closureReason === "STOPPED"
      ? value.closureReason
      : null,
    durationMilliseconds,
  };
}

/**
 * Convert one planned `/api/work-sessions/mine` result into feature props.
 * This is presentation projection only; server checks remain authoritative.
 */
export function projectWorkSessions(readPlan, result, identity = {}, onRetry) {
  const canRead = readPlan?.sessions === true;
  if (!canRead) return null;

  const confirmedCurrentIdentity = identityIsCurrent(identity);
  const eligibility = {
    canPause: confirmedCurrentIdentity,
    canStop: confirmedCurrentIdentity,
  };

  // This route receives the request actor and current actor explicitly so a
  // delayed read can never leave one person's session summaries visible after
  // the signed-in identity changes. The host also guards page lifetimes; this
  // feature boundary fails closed independently.
  if (!confirmedCurrentIdentity) {
    return {
      canRead,
      eligibility,
      read: {
        status: "error",
        message: "Work sessions could not be confirmed for the current account. Refresh Work to load them again.",
        ...(typeof onRetry === "function" ? { onRetry } : {}),
      },
    };
  }

  if (result?.readError) {
    const denied = deniedReadErrors.has(result.readError);
    return {
      canRead,
      eligibility,
      read: denied
        ? {
            status: "denied",
            message: result.readError === "PERMISSION_DENIED"
              ? "You do not have permission to view your recent work sessions."
              : "A required permission is missing for your work sessions.",
          }
        : {
            status: "error",
            message: "Work sessions could not load. Refresh Work to try again.",
            ...(typeof onRetry === "function" ? { onRetry } : {}),
          },
    };
  }

  if (!Array.isArray(result?.sessions)) {
    return {
      canRead,
      eligibility,
      read: {
        status: "error",
        message: "The work-session response could not be read. Refresh Work to try again.",
        ...(typeof onRetry === "function" ? { onRetry } : {}),
      },
    };
  }

  const sessions = result.sessions.map(projectSession);
  if (sessions.some((session) => session === null)) {
    return {
      canRead,
      eligibility,
      read: {
        status: "error",
        message: "The work-session response was incomplete. Refresh Work to try again.",
        ...(typeof onRetry === "function" ? { onRetry } : {}),
      },
    };
  }

  return {
    canRead,
    eligibility,
    read: {
      status: "ready",
      sessions,
      readAt: performance.now(),
    },
  };
}

/** Bind pause/stop to a currently projected running session and the host's protected command lifecycle. */
export function createWorkSessionActions({ target, sessionProps, host } = {}) {
  const {
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    recoverProtectedCommandFailure,
    adminCommandUiError,
    errorText,
    setMessage,
    refreshWork,
  } = host || {};
  const requiredServices = {
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    recoverProtectedCommandFailure,
    adminCommandUiError,
    errorText,
    setMessage,
    refreshWork,
  };
  for (const [name, service] of Object.entries(requiredServices)) {
    if (typeof service !== "function") throw new TypeError(`Work session action service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Work session action target is required");

  async function run(sessionId, action, capability) {
    const sessions = Array.isArray(sessionProps?.read?.sessions) ? sessionProps.read.sessions : [];
    const projectedSession = sessionProps?.read?.status === "ready"
      ? sessions.find((session) => session.id === sessionId && session.state === "running")
      : null;
    if (!projectedSession) throw adminCommandUiError("This work session is no longer available.");

    const context = captureCommandContext(target);
    if (!isCurrentCommand(context) || sessionProps.eligibility?.[capability] !== true) {
      throw adminCommandUiError("Your session access changed. Refresh Work before continuing.");
    }
    try {
      await api(`/api/work-sessions/${encodeURIComponent(sessionId)}/${action}`, requestOptions("POST"));
    } catch (error) {
      if (recoverProtectedCommandFailure(error, context, "Your work-session access changed. Available actions are being refreshed.")) {
        throw adminCommandUiError("Your access changed. Refresh Work before continuing.");
      }
      throw adminCommandUiError(errorText(error));
    }
    if (!isCurrentCommand(context)) throw adminCommandUiError("The Work page changed before this action completed.");
    setMessage(action === "pause" ? "Work session paused." : "Work session stopped.");
    refreshWork();
  }

  return {
    onPause: (sessionId) => run(sessionId, "pause", "canPause"),
    onStop: (sessionId) => run(sessionId, "stop", "canStop"),
  };
}
