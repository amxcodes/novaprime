/** Public first-run setup adapter; API sequencing and bootstrap secrets stay host-owned. */
export function createPublicFirstRunSetupRoute() {
  let progress = {
    founderEmail: "",
    registrationComplete: false,
    registrationOutcomeUnknown: false,
    organisationComplete: false,
    completed: false,
    inFlight: null,
  };

  return async function mountPublicFirstRunSetup(target, lifetime, host) {
    const isCurrent = () => target.isConnected && host.isTargetMounted(target) && host.isCurrentPageRequest(lifetime);
    let feature;
    try {
      feature = await (host.loadFeature || (() => import("../src/features/public/first-run-setup/index.ts")))();
    } catch {
      if (isCurrent()) {
        target.replaceChildren(host.noticeElement("NOVA setup could not load. Reload this page to try again.", "error"));
      }
      return;
    }
    if (!isCurrent()) return;

    const hasCredentialForEmail = (email) => host.hasBootstrapCredentials?.(email) === true;
    const resetProgress = (founderEmail) => {
      progress = {
        founderEmail,
        registrationComplete: false,
        registrationOutcomeUnknown: false,
        organisationComplete: false,
        completed: false,
        inFlight: null,
      };
    };

    host.mountReactIsland(target, feature.FirstRunSetup, {
      initialPublicOrigin: host.publicOrigin(),
      resumeFounder: host.resumeFounder?.() || null,
      notice: host.notice || (progress.completed ? {
        kind: "success",
        title: "Workspace created",
        message: "First-run setup is already complete. Continue in NOVA settings.",
      } : null),
      onCancel: () => {
        if (isCurrent()) host.navigateBack();
      },
      onSubmit: async (values) => {
        if (!isCurrent()) return Promise.reject(pageExpired(feature));
        const founderEmail = String(values.email || "").trim().toLowerCase();
        if (values.founderMode === "resume" && !host.isResumableFounder?.(founderEmail)) {
          return Promise.reject(actionError(feature,
            "The founder session could not be confirmed. Sign in as the founder, then reopen first-run setup.",
            "Founder session unavailable", "warning"));
        }
        if (progress.founderEmail !== founderEmail ||
          (progress.registrationComplete && !hasCredentialForEmail(founderEmail))) {
          resetProgress(founderEmail);
        }
        if (values.founderMode === "resume") progress.registrationComplete = true;
        if (progress.completed) {
          return Promise.reject(actionError(feature,
            "First-run setup has already completed. Continue to NOVA settings.",
            "Workspace already created"));
        }
        if (progress.inFlight) return progress.inFlight;

        const operation = submitSetup(values, founderEmail, progress, feature, host, isCurrent,
          host.currentSessionEmail?.() || "");
        progress.inFlight = operation;
        return operation.finally(() => {
          if (progress.inFlight === operation) progress.inFlight = null;
        });
      },
    });

    if (isCurrent()) {
      const heading = target.querySelector?.("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  };
}

async function submitSetup(values, founderEmail, progress, feature, host, isCurrent, sessionEmailAtStart) {
  const headers = { "x-nova-bootstrap-token": values.bootstrapToken };
  host.retainBootstrapCredentials(values.bootstrapToken, founderEmail);

  if (progress.registrationOutcomeUnknown) {
    const currentSessionEmail = await host.readCurrentSessionEmail?.();
    if (currentSessionEmail !== founderEmail || sessionEmailAtStart === founderEmail) {
      throw actionError(feature,
        "NOVA could not confirm whether the founder account was created. Do not submit founder registration again. Sign in as that founder or ask the deployment operator to check the account before continuing.",
        "Founder account status is uncertain", "warning");
    }
    progress.registrationComplete = true;
    progress.registrationOutcomeUnknown = false;
  }

  if (!progress.registrationComplete && values.founderMode !== "resume") {
    try {
      await host.api("/api/setup/register", host.requestOptions("POST", {
        email: values.email,
        name: values.name,
        password: values.password,
      }, headers));
      progress.registrationComplete = true;
    } catch (error) {
      if (!Number.isFinite(error?.httpStatus)) {
        progress.registrationOutcomeUnknown = true;
        let currentSessionEmail = null;
        try {
          if (host.readCurrentSessionEmail) currentSessionEmail = await host.readCurrentSessionEmail();
        } catch {
          // No readback means the registration result remains explicitly unknown.
        }
        if (currentSessionEmail === founderEmail && sessionEmailAtStart !== founderEmail) {
          progress.registrationComplete = true;
          progress.registrationOutcomeUnknown = false;
        } else {
          throw actionError(feature,
            "NOVA lost the response while creating the founder account, so it cannot confirm whether the account exists. Do not submit founder registration again. Sign in as that founder or ask the deployment operator to check the account before continuing.",
            "Founder account status is uncertain", "warning");
        }
      } else {
      throw registrationError(feature, error);
      }
    }
  }
  if (!isCurrent()) throw pageExpired(feature);

  if (!progress.organisationComplete) {
    try {
      await host.api("/api/organisation/bootstrap", host.requestOptions("POST", {
        organisationName: values.organisationName,
        attendanceMode: values.attendanceMode,
        requiredAttendanceMinutes: Number(values.requiredAttendanceMinutes),
      }, headers));
      progress.organisationComplete = true;
    } catch (error) {
      if (error?.code === "ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED" && isCurrent()) {
        try {
          // A retry after a lost bootstrap response may receive the one-time
          // conflict. Confirm this signed-in founder can read the bootstrapped
          // organisation before treating that response as this setup's success.
          await host.api("/api/organisation/public-origin", host.requestOptions("GET", undefined, headers));
          progress.organisationComplete = true;
        } catch {
          throw workspaceBootstrapError(feature, error);
        }
      } else {
        throw workspaceBootstrapError(feature, error);
      }
    }
  }
  if (!isCurrent()) throw pageExpired(feature);

  let originSaved = false;
  let originSaveError = null;
  try {
    const result = await host.api("/api/organisation/public-origin", host.requestOptions(
      "PATCH",
      { origin: values.publicOrigin },
      headers,
    ));
    if (!isCurrent()) throw pageExpired(feature);
    originSaved = Boolean(result?.configuredOrigin);
    host.recordPublicOrigin(result);
  } catch (error) {
    if (error instanceof feature.FirstRunSetupActionError) throw error;
    if (!isCurrent()) throw pageExpired(feature);
    originSaveError = error;
    try {
      const readback = await host.api("/api/organisation/public-origin", host.requestOptions("GET", undefined, headers));
      if (!isCurrent()) throw pageExpired(feature);
      originSaved = readback?.configuredOrigin === normalizeOrigin(values.publicOrigin);
      host.recordPublicOrigin(readback);
    } catch (readbackError) {
      if (readbackError instanceof feature.FirstRunSetupActionError) throw readbackError;
      if (!isCurrent()) throw pageExpired(feature);
    }
    if (!originSaved) host.publicOriginSaveFailed(error);
  }

  if (!isCurrent()) throw pageExpired(feature);
  await host.completeSetup({ originSaved, originSaveError });
  progress.completed = true;
}

function registrationError(feature, error) {
  if (error?.code === "ORGANISATION_BOOTSTRAP_TOKEN_INVALID") {
    return actionError(feature, "The deployment setup token was not accepted. Check the token with your deployment operator.", "Check the setup token");
  }
  if (error?.code === "ORGANISATION_BOOTSTRAP_CONFIGURATION_REQUIRED") {
    return actionError(feature, "NOVA is missing its bootstrap configuration. Ask the deployment operator to check the setup token configuration.", "Setup configuration required");
  }
  if (error?.code === "ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED") {
    return actionError(feature, "This deployment has already created its founding account. Sign in or ask the deployment operator for help.", "Setup already completed");
  }
  return actionError(feature, "NOVA could not create the founding account. Check the email and connection, then try again.", "Founder account was not created");
}

function workspaceBootstrapError(feature, error) {
  if (error?.code === "ORGANISATION_BOOTSTRAP_TOKEN_INVALID") {
    return actionError(feature, "The founder account was created, but the deployment setup token was not accepted for workspace setup. Check it with the deployment operator, then retry.", "Founder account created; token needs attention", "warning");
  }
  if (error?.code === "ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED") {
    return actionError(feature, "This deployment is already bootstrapped, but NOVA could not confirm that this founder owns it. Stop here and ask the deployment operator to check the existing founder account.", "Existing workspace needs operator review", "warning");
  }
  return actionError(feature, "The founder account was created, but workspace setup did not finish. Keep this page open and retry; NOVA will continue from the completed account step.", "Founder account created; workspace setup is incomplete", "warning");
}

function normalizeOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

function pageExpired(feature) {
  return actionError(feature, "This setup page is no longer active. Reopen setup to continue.", "Setup page changed", "warning");
}

function actionError(feature, message, title, kind = "error") {
  return new feature.FirstRunSetupActionError(message, { kind, title });
}
