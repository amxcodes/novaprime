/** Public password-reset adapter; the URL token stays inside this host closure. */
export async function mountPublicPasswordReset(target, lifetime, token, linkRejected, host) {
  const isCurrent = () => target.isConnected && host.isTargetMounted(target) && host.isCurrentPageRequest(lifetime);
  const tokenAvailable = typeof token === "string" && token.length > 0 && linkRejected !== true;
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/public/password-reset/index.ts")))();
  } catch {
    if (isCurrent()) {
      target.replaceChildren(host.noticeElement("Password reset could not load. Reload this page to try again.", "error"));
    }
    return;
  }
  if (!isCurrent()) return;

  host.mountReactIsland(target, feature.PasswordReset, {
    linkAvailable: tokenAvailable,
    onResetPassword: async (newPassword) => {
      if (!isCurrent()) throw new Error("PASSWORD_RESET_CONTEXT_EXPIRED");
      if (!tokenAvailable) throw new feature.PasswordResetLinkError();
      try {
        await host.api("/api/auth/reset-password", host.requestOptions("POST", {
          newPassword,
          token,
        }));
      } catch (error) {
        if (isInvalidResetToken(error)) throw new feature.PasswordResetLinkError();
        throw error;
      }
      if (!isCurrent()) throw new Error("PASSWORD_RESET_CONTEXT_EXPIRED");
      host.completePasswordReset();
    },
    onRequestNewLink: () => {
      if (isCurrent()) host.navigateToPasswordRecovery();
    },
    onBackToSignIn: () => {
      if (isCurrent()) host.navigateToSignIn();
    },
  });

  if (isCurrent()) {
    const heading = target.querySelector?.("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}

function isInvalidResetToken(error) {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  const status = error?.httpStatus;
  return [400, 401, 404].includes(status) && /TOKEN|EXPIRED/.test(code);
}
