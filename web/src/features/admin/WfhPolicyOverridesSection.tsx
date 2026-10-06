import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import { StateMessage } from "../../design-system/primitives/StateMessage";
import type { WfhPolicyOverridesProjectionInput } from "./wfh-policy-projection";
import { WfhPolicyOverridesFallback } from "./WfhPolicyOverridesFallback";
import { projectWfhPolicyOverridesProps } from "./wfh-policy-projection";
import styles from "./WfhPolicyOverridesSection.module.css";

const DeferredWfhPolicyOverrides = lazy(() =>
  import("./WfhPolicyOverrides").then(({ WfhPolicyOverrides }) => ({ default: WfhPolicyOverrides })),
);

class WfhPolicyOverridesLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed
      ? <StateMessage kind="error" title="WFH eligibility overrides could not load">The WFH override controls could not load. Reload Admin to try again.</StateMessage>
      : this.props.children;
  }
}

/** Independently grant-filtered Admin section; read, manage, and target access stay separate. */
export function WfhPolicyOverridesSection(input: WfhPolicyOverridesProjectionInput): ReactElement {
  const props = projectWfhPolicyOverridesProps(input);
  return (
    <section className={styles.section} aria-labelledby="admin-wfh-policy-overrides-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Availability</p>
        <h2 className={styles.title} id="admin-wfh-policy-overrides-title">WFH eligibility overrides</h2>
        <p className={styles.description}>
          Most-specific effective rule wins: person, then department, then office, then role policy.
        </p>
      </header>
      <WfhPolicyOverridesLoadBoundary>
        <Suspense fallback={<StateMessage kind="loading" title="Loading WFH eligibility overrides">Preparing the policy form and authorized targets.</StateMessage>}>
          <DeferredWfhPolicyOverrides {...props} />
        </Suspense>
      </WfhPolicyOverridesLoadBoundary>
    </section>
  );
}
