import type { ReactElement } from "react";
import { StateMessage } from "../../design-system/primitives/StateMessage";
import styles from "./AvailabilityConfigurationFallback.module.css";

export type AvailabilityConfigurationFallbackState = "loading" | "error";

const copy: Record<AvailabilityConfigurationFallbackState, { kind: "loading" | "error"; title: string; detail: string }> = {
  loading: {
    kind: "loading",
    title: "Loading availability configuration",
    detail: "Reading shifts, working calendars, and office holidays.",
  },
  error: {
    kind: "error",
    title: "Availability configuration could not load",
    detail: "The availability controls could not load. Reload Admin to try again.",
  },
};

/** Feature-owned fallback with the same single heading used by the editor. */
export function AvailabilityConfigurationFallback({ state }: { state: AvailabilityConfigurationFallbackState }): ReactElement {
  const message = copy[state];
  return (
    <section className={styles.section} aria-labelledby="admin-availability-configuration-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Availability</p>
        <h2 className={styles.title} id="admin-availability-configuration-title">Availability configuration</h2>
        <p className={styles.description}>Set reusable shifts, office working calendars, and holiday closures.</p>
      </header>
      <StateMessage kind={message.kind} title={message.title}>{message.detail}</StateMessage>
    </section>
  );
}

/** Eagerly available from Admin's section module if this feature chunk fails. */
export function AvailabilityConfigurationLoadFailureSection(): ReactElement {
  return <AvailabilityConfigurationFallback state="error" />;
}
