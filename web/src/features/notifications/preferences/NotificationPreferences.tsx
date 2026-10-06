import { Button, EmptyState, Loading, SectionHeading, StateMessage, Surface } from "../../../design-system";
import type { EmailPreference, PreferenceReadState } from "../contracts";
import styles from "./NotificationPreferences.module.css";

export interface NotificationPreferencesProps {
  state: PreferenceReadState;
  pendingEventKeys: ReadonlyArray<string>;
  onSetEmailPreference: (eventKey: string, enabled: boolean, source: HTMLButtonElement) => Promise<void>;
  onRetry: () => void;
}

function EmailPreferenceRow({
  preference,
  pending,
  onChange,
}: {
  preference: EmailPreference;
  pending: boolean;
  onChange: NotificationPreferencesProps["onSetEmailPreference"];
}) {
  const descriptionId = `notification-preference-${encodeURIComponent(preference.eventKey)}`;

  return (
    <li className={styles.row}>
      <div className={styles.copy}>
        <span className={styles.label}>{preference.label}</span>
        <span className={styles.description} id={descriptionId}>
          Optional email for this activity.
        </span>
      </div>
      <button
        className={styles.switch}
        type="button"
        role="switch"
        aria-checked={preference.enabled}
        aria-label={`Email ${preference.label}`}
        aria-describedby={descriptionId}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={(event) => { void onChange(preference.eventKey, !preference.enabled, event.currentTarget); }}
      >
        <span className={styles.thumb} aria-hidden="true" />
        <span className={styles.value}>{preference.enabled ? "On" : "Off"}</span>
      </button>
    </li>
  );
}

export function NotificationPreferences({ state, pendingEventKeys, onSetEmailPreference, onRetry }: NotificationPreferencesProps) {
  const pending = new Set(pendingEventKeys);

  return (
    <Surface as="section" level="subtle" className={styles.root} aria-labelledby="notification-preferences-title">
      <SectionHeading
        title={<span id="notification-preferences-title">Email notifications</span>}
        description="Choose which notification activity can also reach you by email. Invitations, verification, and password-reset messages are managed separately."
      />
      {state.status === "loading" ? (
        <div className={styles.state} aria-busy="true"><Loading label="Loading email preferences" /></div>
      ) : state.status === "failed" ? (
        <div className={styles.state}>
          <StateMessage kind="error" title="Email preferences could not load">{state.message}</StateMessage>
          <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button>
        </div>
      ) : state.preferences.length === 0 ? (
        <EmptyState title="No email notification options" description="There are no optional notification emails to configure for this account." />
      ) : (
        <ul className={styles.list} aria-label="Email notification preferences">
          {state.preferences.map((preference) => (
            <EmailPreferenceRow
              key={`${preference.eventKey}:email`}
              preference={preference}
              pending={pending.has(preference.eventKey)}
              onChange={onSetEmailPreference}
            />
          ))}
        </ul>
      )}
    </Surface>
  );
}
