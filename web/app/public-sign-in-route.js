/** Public sign-in adapter: API/session behavior stays in the existing app host. */
export async function mountPublicSignIn(target, lifetime, host) {
  const isCurrentMount = () => target.isConnected && host.isTargetMounted(target);
  const isCurrent = () => isCurrentMount() && host.isCurrentPageRequest(lifetime);
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/public/sign-in/index.ts")))();
  } catch {
    if (isCurrent()) {
      target.replaceChildren(host.noticeElement("Sign-in could not load. Reload this page to try again.", "error"));
    }
    return;
  }
  if (!isCurrent()) return;

  host.mountReactIsland(target, feature.SignIn, {
    notice: host.notice,
    onSignIn: async ({ email, password }) => {
      if (!isCurrent()) throw new Error("SIGN_IN_CONTEXT_EXPIRED");
      const context = host.captureCommandContext(target);
      try {
        await host.api("/api/auth/sign-in/email", host.requestOptions("POST", { email, password }));
      } catch (error) {
        // Match the legacy command boundary if this route was opened from an
        // existing session: protected-command recovery still owns 401/403.
        if (host.state.session && host.isCurrentCommandIdentity(context)) {
          host.recoverProtectedCommandFailure(error, context);
        }
        throw error;
      }
      await host.refreshSession();
      if (!host.state.session) {
        const error = new Error("AUTHENTICATION_REQUIRED");
        error.code = "AUTHENTICATION_REQUIRED";
        throw error;
      }

      if (isCurrent() || (isCurrentMount() && host.isLoginRoute())) {
        host.completeSignIn();
      } else {
        // The login request may finish after browser navigation. Re-render the
        // current route with the newly established session, without hijacking it.
        host.renderCurrentRoute();
      }
    },
    onForgotPassword: () => {
      if (isCurrent()) host.navigateToForgotPassword();
    },
    onBack: () => {
      if (isCurrent()) host.navigateBack();
    },
  });
  if (isCurrent()) {
    const heading = target.querySelector?.("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  host.consumeNotice?.(host.notice);
}
