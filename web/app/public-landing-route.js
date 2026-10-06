/** Public landing adapter: route navigation stays in the existing app host. */
export async function mountPublicLanding(target, lifetime, host) {
  const isCurrent = () => target.isConnected && host.isTargetMounted(target) &&
    host.isCurrentPageRequest(lifetime);
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/public/landing/index.ts")))();
  } catch {
    if (isCurrent()) {
      target.replaceChildren(host.noticeElement("NOVA could not load. Reload this page to try again.", "error"));
    }
    return;
  }
  if (!isCurrent()) return;

  host.mountReactIsland(target, feature.Landing, {
    onSetup: () => { if (isCurrent()) host.navigateToSetup(); },
    onSignIn: () => { if (isCurrent()) host.navigateToSignIn(); },
    onAcceptInvitation: () => { if (isCurrent()) host.navigateToInvitation(); },
    onDeploymentGuide: () => { if (isCurrent()) host.navigateToDeploymentGuide(); },
  });

  if (!isCurrent()) return;
  const heading = target.querySelector?.("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
