const unavailableMessage = "This invitation link is incomplete. Ask the person who invited you to send a new invitation link.";

/** Public invitation adapter; the opaque invitation token stays in this host closure. */
export async function mountPublicInvitationAcceptance(target, lifetime, token, host) {
  const isCurrent = () => target.isConnected && host.isTargetMounted(target) && host.isCurrentPageRequest(lifetime);
  const invitationAvailable = typeof token === "string" && token.length > 0;
  let feature;
  try {
    feature = await (host.loadFeature || (() => import("../src/features/public/invitation-acceptance/index.ts")))();
  } catch {
    if (isCurrent()) {
      target.replaceChildren(host.noticeElement("Invitation acceptance could not load. Reload this page to try again.", "error"));
    }
    return;
  }
  if (!isCurrent()) return;

  const hostNotice = host.notice || null;
  const notice = invitationAvailable ? hostNotice : null;
  host.mountReactIsland(target, feature.InvitationAcceptance, {
    invitationAvailable,
    notice,
    onBackToSignIn: () => {
      if (isCurrent()) host.navigateToSignIn();
    },
    onReturnToNOVA: () => {
      if (isCurrent()) host.navigateToNOVA();
    },
    onAccept: async ({ email, name, password }) => {
      if (!isCurrent()) throw new Error("INVITATION_CONTEXT_EXPIRED");
      if (!invitationAvailable) {
        throw new feature.InvitationAcceptanceError("warning", unavailableMessage);
      }
      const result = await host.api("/api/invitations/accept", host.requestOptions("POST", {
        email,
        invitationToken: token,
        name,
        password,
      }));
      if (!isCurrent()) {
        throw new feature.InvitationAcceptanceError("warning", "This invitation page is no longer active. Reopen the invitation link to continue.");
      }
      return typeof result?.verificationSent === "boolean"
        ? { verificationSent: result.verificationSent }
        : undefined;
    },
  });
  if (isCurrent()) {
    const heading = target.querySelector?.("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  if (hostNotice) host.consumeNotice?.(hostNotice);
}
