const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Settings host adapter for Email Delivery. API access, live command guards,
 * identity lifetime, and the separate public-origin read remain host-owned.
 */
export async function mountSettingsEmailDeliveryRoute({
  target,
  isCurrentSettings,
  canReadOrigin,
  canActWithUnknownPublicOrigin,
  originBridge,
  host,
} = {}) {
  const {
    state,
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    mountReactIsland,
    noticeElement,
    errorText,
    setMessage,
    showFeedback,
    navigateToGoogleAuthorization,
  } = host;
  const identityEpoch = state.identityEpoch;
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/settings/email-delivery/index.ts")))();
  } catch {
    if (isCurrentSettings() && target.isConnected && identityEpoch === state.identityEpoch) {
      target.replaceChildren(noticeElement("Email delivery settings could not load. Reload Settings to try again.", "error"));
      if (state.emailOAuthResult) {
        const oauthResult = state.emailOAuthResult;
        state.emailOAuthResult = null;
        setMessage(oauthResult.message, oauthResult.status === "error" ? "error" : "warning");
        showFeedback();
      }
    }
    return;
  }

  if (!isCurrentSettings() || !target.isConnected || identityEpoch !== state.identityEpoch) return;
  let originRead = canReadOrigin
    ? originBridge.current
    : { status: "error", message: "Your current access cannot read the approved public origin." };
  const oauthResult = state.emailOAuthResult;
  state.emailOAuthResult = null;
  let readState = { status: "loading" };
  let supportedProviders = [];
  let connections = [];
  let runtimeNotice;
  let connectionReadGeneration = 0;

  const isCurrent = () => identityEpoch === state.identityEpoch && isCurrentSettings() && target.isConnected;
  const publish = () => {
    if (!isCurrent()) return;
    const originError = originRead?.status === "error" ? originRead.message : undefined;
    const originConfigured = canReadOrigin && originRead?.status === "ready"
      ? Boolean(originRead.configuredOrigin)
      : null;
    mountReactIsland(target, feature.EmailDelivery, {
      readState,
      publicOriginConfigured: originConfigured,
      canActWithUnknownPublicOrigin,
      publicOriginError: originError,
      publicOrigin: originConfigured ? originRead.configuredOrigin || originRead.effectiveOrigin : undefined,
      supportedProviders,
      runtimeNotice,
      connections,
      ...(oauthResult ? { oauthResult } : {}),
      onRetry: () => { void refreshConnections(); },
      ...(canReadOrigin ? { onRetryOrigin: () => { originBridge.retry?.(); } } : {}),
      onCreate: async (input) => performAction(
        () => api("/api/email-connections", requestOptions("POST", input)),
        ["EMAIL_CONNECTION_ALREADY_EXISTS", "PUBLIC_ORIGIN_NOT_CONFIGURED"],
      ),
    });
  };

  if (canReadOrigin) {
    originBridge.subscribe((next) => {
      originRead = next;
      publish();
    });
  }

  async function refreshConnections() {
    if (!isCurrent()) return;
    const generation = ++connectionReadGeneration;
    const context = captureCommandContext(target);
    readState = { status: "loading" };
    publish();
    try {
      const result = await api("/api/email-connections");
      if (!isCurrent() || generation !== connectionReadGeneration) return;
      if (!Array.isArray(result?.supportedProviders) || !Array.isArray(result?.connections)) {
        throw new Error("EMAIL_CONNECTION_RESPONSE_INVALID");
      }
      supportedProviders = feature.projectSupportedEmailProviders(result.supportedProviders);
      const supported = new Set(supportedProviders);
      const projected = result.connections.map((connection) => {
        if (typeof connection?.id !== "string" || !uuidPattern.test(connection.id)) return null;
        const connectionId = encodeURIComponent(connection.id);
        const provider = connection.provider;
        const actions = {
          onTest: (recipientEmail) => performAction(
            () => api(`/api/email-connections/${connectionId}/test`, requestOptions("POST", { recipientEmail })),
          ),
          onActivate: () => performAction(
            () => api(`/api/email-connections/${connectionId}/activate`, requestOptions("POST")),
            ["EMAIL_CONNECTION_NOT_TESTED", "PUBLIC_ORIGIN_NOT_CONFIGURED", "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME"],
          ),
          onDeactivate: () => performAction(
            () => api(`/api/email-connections/${connectionId}/deactivate`, requestOptions("POST")),
          ),
          ...(provider === "gmail_oauth2" ? {
            onConnectGoogle: () => performAction(async () => {
              const result = await api(`/api/email-connections/${connectionId}/gmail/connect`, requestOptions("POST"));
              const authorization = new URL(result?.authorizationUrl);
              if (authorization.origin !== "https://accounts.google.com") {
                throw new Error("GMAIL_AUTHORIZATION_URL_INVALID");
              }
              navigateToGoogleAuthorization(authorization.toString());
            }, ["PUBLIC_ORIGIN_NOT_CONFIGURED", "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME"], false),
          } : {}),
        };
        return feature.projectEmailConnection(connection, supported.has(provider), actions);
      });
      if (projected.some((connection) => connection === null)) {
        throw new Error("EMAIL_CONNECTION_RESPONSE_INVALID");
      }
      connections = projected;
      runtimeNotice = supported.has("smtp")
        ? undefined
        : "SMTP is not available in this runtime. The provider list contains the methods supported here.";
      readState = { status: "ready" };
    } catch (error) {
      if (!isCurrent() || generation !== connectionReadGeneration) return;
      if (isCurrentCommandIdentity(context) && recoverProtectedCommandFailure(
        error,
        context,
        "Super Admin access changed. Refresh Settings to check the current permissions.",
      )) return;
      readState = { status: "error", message: errorText(error) };
    }
    publish();
  }

  async function performAction(work, conflictCodes = [], refreshAfter = true) {
    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) {
      throw new feature.EmailDeliveryActionError("error", "Settings changed before this action could start. Reload and try again.");
    }
    try {
      const result = await work();
      if (!isCurrentCommand(context)) {
        throw new feature.EmailDeliveryActionError("unconfirmed", "Settings changed before the action completed. Refresh to confirm its status.");
      }
      if (refreshAfter) await refreshConnections();
      return result;
    } catch (error) {
      if (error instanceof feature.EmailDeliveryActionError) throw error;
      if (!isCurrentCommandIdentity(context)) {
        throw new feature.EmailDeliveryActionError("error", "Your session changed. Sign in again before continuing.");
      }
      const changedMessage = "Super Admin access changed while saving. Refresh Settings to check the current permissions.";
      if (recoverProtectedCommandFailure(error, context, changedMessage)) {
        throw new feature.EmailDeliveryActionError("error", changedMessage);
      }
      if (!isCurrentCommand(context)) {
        throw new feature.EmailDeliveryActionError(
          feature.classifyEmailDeliveryActionFailure(error),
          "Settings changed before the action completed. Refresh to confirm its status.",
        );
      }
      throw new feature.EmailDeliveryActionError(
        conflictCodes.includes(error?.code) ? "conflict" : feature.classifyEmailDeliveryActionFailure(error),
        errorText(error),
      );
    }
  }

  publish();
  void refreshConnections();
}
