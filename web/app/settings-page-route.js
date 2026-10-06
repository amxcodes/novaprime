/** Mount the Settings frame and route its already-authorized feature slots. */
export async function mountSettingsPage({
  target,
  capabilities,
  isCurrentSettings,
  mountIsland,
  showFeedback,
  renderLoadError,
  sections,
  loadPage = () => import("../src/pages/settings/SettingsPage.tsx"),
} = {}) {
  const requiredServices = {
    isCurrentSettings,
    mountIsland,
    showFeedback,
    renderLoadError,
    loadPage,
    mountAccountSecurity: sections?.mountAccountSecurity,
    mountNotificationPreferences: sections?.mountNotificationPreferences,
    renderAppearance: sections?.renderAppearance,
    updateWorkspace: sections?.updateWorkspace,
    updateSavedTaskViews: sections?.updateSavedTaskViews,
    mountPublicOrigin: sections?.mountPublicOrigin,
    mountEmailDelivery: sections?.mountEmailDelivery,
    mountAuthHandoffs: sections?.mountAuthHandoffs,
  };
  for (const [name, service] of Object.entries(requiredServices)) {
    if (typeof service !== "function") throw new TypeError(`Settings page route service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Settings page route target is required");

  let SettingsPage;
  try {
    ({ SettingsPage } = await loadPage());
  } catch {
    if (isCurrentSettings()) renderLoadError("Settings could not load. Reload the page to try again.");
    return false;
  }
  if (!isCurrentSettings()) return false;

  mountIsland(target, SettingsPage, capabilities);
  showFeedback();

  const accountSecurityRoot = target.querySelector("#account-security-root");
  if (accountSecurityRoot) sections.mountAccountSecurity(accountSecurityRoot, isCurrentSettings);

  const notificationPreferencesRoot = target.querySelector("#notification-preferences-root");
  if (notificationPreferencesRoot) {
    sections.mountNotificationPreferences(notificationPreferencesRoot, isCurrentSettings);
  }

  sections.renderAppearance();
  sections.updateWorkspace();
  sections.updateSavedTaskViews();

  const originBridge = {
    current: capabilities.canManagePublicOrigin
      ? { status: "loading" }
      : { status: "error", message: "Your current access cannot read the approved public origin." },
    listeners: new Set(),
    retry: null,
    publish(readState) {
      this.current = readState;
      for (const listener of this.listeners) listener(readState);
    },
    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.current);
      return () => this.listeners.delete(listener);
    },
  };

  const originRoot = target.querySelector("#public-origin-root");
  if (originRoot) {
    void sections.mountPublicOrigin(originRoot, isCurrentSettings, originBridge);
  }

  const emailRoot = target.querySelector("#email-delivery-root");
  if (emailRoot) {
    void sections.mountEmailDelivery({
      target: emailRoot,
      isCurrentSettings,
      canReadOrigin: capabilities.canManagePublicOrigin,
      canActWithUnknownPublicOrigin: capabilities.canManageEmail && !capabilities.canManagePublicOrigin,
      originBridge,
    });
  }

  if (!isCurrentSettings()) return true;
  const authHandoffsRoot = target.querySelector("#auth-handoffs-root");
  if (authHandoffsRoot) sections.mountAuthHandoffs(authHandoffsRoot, isCurrentSettings);
  return true;
}
