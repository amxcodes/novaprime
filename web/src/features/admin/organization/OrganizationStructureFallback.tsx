import { useId, type ReactElement } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import styles from "./OrganizationStructureFallback.module.css";

export type OrganizationStructureFallbackState = "loading" | "error";

const messages: Record<OrganizationStructureFallbackState, { kind: "loading" | "error"; title: string; detail: string }> = {
  loading: {
    kind: "loading",
    title: "Loading offices and departments",
    detail: "Reading organization structure.",
  },
  error: {
    kind: "error",
    title: "Organization structure could not load",
    detail: "Offices and departments could not load. Reload Admin to try again.",
  },
};

/** Feature-owned loading/error frame with the same single heading as the live section. */
export function OrganizationStructureFallback({ state }: { state: OrganizationStructureFallbackState }): ReactElement {
  const headingId = useId();
  const message = messages[state];
  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Organisation</p>
          <h2 className={styles.title} id={headingId}>Offices and departments</h2>
          <p className={styles.description}>Review the offices and departments configured for this organisation.</p>
        </div>
      </header>
      <StateMessage kind={message.kind} title={message.title}>{message.detail}</StateMessage>
    </section>
  );
}

/** Eagerly available through the lazy Admin sections module if the wrapper chunk fails. */
export function OrganizationStructureLoadFailureSection(): ReactElement {
  return <OrganizationStructureFallback state="error" />;
}
