/** Public password-recovery adapter; the application host owns the API and origin. */
export async function mountPublicPasswordRecovery(target, lifetime, host) {
  const isCurrent = () => target.isConnected && host.isTargetMounted(target) && host.isCurrentPageRequest(lifetime);
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/public/password-recovery/index.ts")))();
  } catch {
    if (isCurrent()) {
      target.replaceChildren(host.noticeElement("Password recovery could not load. Reload this page to try again.", "error"));
    }
    return;
  }
  if (!isCurrent()) return;

  host.mountReactIsland(target, feature.PasswordRecovery, {
    onRequestReset: async (email) => {
      if (!isCurrent()) throw new Error("PASSWORD_RECOVERY_CONTEXT_EXPIRED");
      await host.api("/api/auth/request-password-reset", host.requestOptions("POST", {
        email,
        redirectTo: host.publicOrigin() + "/reset-password",
      }));
      if (!isCurrent()) throw new Error("PASSWORD_RECOVERY_CONTEXT_EXPIRED");
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
