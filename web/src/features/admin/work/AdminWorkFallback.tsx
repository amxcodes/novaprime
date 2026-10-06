import { useId, type ReactElement } from "react";
import { SectionHeading } from "../../../design-system/primitives/PageHeader";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import styles from "./AdminWorkFallback.module.css";

/** Route-level fallback when the Admin Work composition chunk itself fails. */
export function AdminWorkLoadFailureSection(): ReactElement {
  const titleId = useId();
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <SectionHeading title={<span id={titleId}>Client work and task operations</span>} />
      <StateMessage kind="error" title="Work tools could not load">
        Reload Admin to try again. Other authorized Admin sections remain available.
      </StateMessage>
    </section>
  );
}
