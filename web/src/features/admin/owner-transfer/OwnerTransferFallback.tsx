import { StateMessage } from "../../../design-system";
import styles from "./OwnerTransferFallback.module.css";

export function OwnerTransferLoadFailureSection() {
  return (
    <section className={styles.root} aria-labelledby="admin-owner-transfer-title">
      <h2 id="admin-owner-transfer-title">Ownership transfer</h2>
      <StateMessage kind="error" title="Ownership transfer could not load">
        Reload Admin to try again.
      </StateMessage>
    </section>
  );
}
