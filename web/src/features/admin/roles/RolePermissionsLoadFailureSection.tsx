import type { ReactElement } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import styles from "./RolePermissionsLoadFailureSection.module.css";

/** Eagerly available, feature-owned fallback for a failed Roles chunk import. */
export function RolePermissionsLoadFailureSection(): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="admin-role-permissions-title">
      <header className={styles.header}>
        <h2 className={styles.title} id="admin-role-permissions-title">Roles and permissions</h2>
        <p className={styles.description}>
          Build configurable roles from the canonical permission catalogue. Protected Super Admin cannot be edited.
        </p>
      </header>
      <StateMessage className={styles.error} kind="error" title="Role and permission controls could not load">
        Role and permission controls could not load. Reload Admin to try again.
      </StateMessage>
    </section>
  );
}
