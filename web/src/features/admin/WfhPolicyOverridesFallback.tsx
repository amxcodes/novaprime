import type { ReactElement } from "react";
import { StateMessage } from "../../design-system/primitives/StateMessage";
import styles from "./WfhPolicyOverridesSection.module.css";

export type WfhPolicyOverridesFallbackState = "loading" | "error";

const messages: Record<WfhPolicyOverridesFallbackState, { kind: "loading" | "error"; title: string; detail: string }> = {
  loading: {
    kind: "loading",
    title: "Loading WFH eligibility overrides",
    detail: "Preparing the policy form and authorized targets.",
  },
  error: {
    kind: "error",
    title: "WFH eligibility overrides could not load",
    detail: "The WFH override controls could not load. Reload Admin to try again.",
  },
};

/** Complete fallback frame used when the lazily loaded Admin section cannot start. */
export function WfhPolicyOverridesFallback({ state }: { state: WfhPolicyOverridesFallbackState }): ReactElement {
  const message = messages[state];
  return (
    <section className={styles.section} aria-labelledby="admin-wfh-policy-overrides-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Availability</p>
        <h2 className={styles.title} id="admin-wfh-policy-overrides-title">WFH eligibility overrides</h2>
        <p className={styles.description}>
          Most-specific effective rule wins: person, then department, then office, then role policy.
        </p>
      </header>
      <StateMessage kind={message.kind} title={message.title}>{message.detail}</StateMessage>
    </section>
  );
}

/** Eagerly available to Admin if this feature's lazy wrapper chunk fails. */
export function WfhPolicyOverridesLoadFailureSection(): ReactElement {
  return <WfhPolicyOverridesFallback state="error" />;
}
