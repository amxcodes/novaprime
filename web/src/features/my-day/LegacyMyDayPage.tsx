import type { ReactNode } from "react";
import styles from "./LegacyMyDayPage.module.css";

/** Transitional layout adapter for the existing host-owned My Day markup. */
export function LegacyMyDayPage({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}
