import { PageHeader } from "../../design-system";
import styles from "./SettingsPage.module.css";

export interface SettingsPageProps {
  canManagePublicOrigin: boolean;
  canManageEmail: boolean;
  canShowAuthHandoffs: boolean;
}

function LoadingSlot({ children }: { children: string }) {
  return <p className={styles.placeholder} role="status">{children}</p>;
}

/**
 * Settings route composition only. The route host decides which protected
 * slots exist and retains API reads, grants, commands, and feature lifetimes.
 */
export function SettingsPage({ canManagePublicOrigin, canManageEmail, canShowAuthHandoffs }: SettingsPageProps) {
  const hasAdministrativeSettings = canManagePublicOrigin || canManageEmail || canShowAuthHandoffs;

  return (
    <section className={styles.page} aria-labelledby="settings-page-title">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          title={<span id="settings-page-title">Settings</span>}
          description="Manage your account, personal workspace, and the NOVA services available to your role."
        />

        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />

        <div className={styles.sections}>
          <div className={styles.slot} data-settings-slot="account-security">
            <div id="account-security-root"><LoadingSlot>Loading account security.</LoadingSlot></div>
          </div>

          <div className={styles.slot} data-settings-slot="appearance">
            <div id="appearance-editor-root" />
          </div>

          <div className={`${styles.slot} ${styles.workspaceSlot}`} data-settings-slot="workspace">
            <div id="workspace-customization-content" />
            <div id="saved-task-views-content" data-settings-subslot="saved-task-views" />
          </div>

          <div className={styles.slot} data-settings-slot="notification-preferences">
            <div id="notification-preferences-root"><LoadingSlot>Loading email preferences.</LoadingSlot></div>
          </div>

          {hasAdministrativeSettings ? (
            <div className={styles.administrativeSettings} data-settings-group="administrative">
              {canManagePublicOrigin ? (
                <div className={styles.slot} data-settings-slot="public-origin">
                  <div id="public-origin-root"><LoadingSlot>Loading public origin settings.</LoadingSlot></div>
                </div>
              ) : null}

              {canManageEmail ? (
                <div className={styles.slot} data-settings-slot="email-delivery">
                  <div id="email-delivery-root"><LoadingSlot>Loading email delivery settings.</LoadingSlot></div>
                </div>
              ) : null}

              {canShowAuthHandoffs ? (
                <section className={`${styles.slot} ${styles.handoffs}`} data-settings-slot="auth-handoffs" aria-labelledby="auth-handoffs-title">
                  <header className={styles.handoffsHeader}>
                    <h2 id="auth-handoffs-title">Secure system handoffs</h2>
                    <p>Reveal an eligible invitation, verification, or password-reset link once for secure handoff.</p>
                  </header>
                  <div id="auth-handoffs-root"><LoadingSlot>Loading secure handoffs.</LoadingSlot></div>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
