import type { ReactElement } from "react";
import { StateMessage } from "../../design-system/primitives/StateMessage";
import styles from "./PeopleAdministrationFallback.module.css";

export type PeopleAdministrationFallbackState = "loading" | "error";

const messages: Record<PeopleAdministrationFallbackState, { kind: "loading" | "error"; title: string; detail: string }> = {
  loading: {
    kind: "loading",
    title: "Loading people and onboarding",
    detail: "Preparing the people controls for your authorized organisation access.",
  },
  error: {
    kind: "error",
    title: "People controls could not load",
    detail: "People and onboarding controls could not load. Reload Admin to try again.",
  },
};

export function PeopleAdministrationFallback({ state }: { state: PeopleAdministrationFallbackState }): ReactElement {
  const message = messages[state];
  return (
    <section className={styles.section} aria-labelledby="admin-people-administration-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Administration</p>
        <h2 className={styles.title} id="admin-people-administration-title">People and onboarding</h2>
        <p className={styles.description}>
          Invite people, complete their operational setup, and manage access while preserving their employment history.
        </p>
      </header>
      <StateMessage kind={message.kind} title={message.title}>{message.detail}</StateMessage>
    </section>
  );
}

export function PeopleAdministrationLoadFailureSection(): ReactElement {
  return <PeopleAdministrationFallback state="error" />;
}
