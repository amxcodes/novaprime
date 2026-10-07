import type { MouseEvent, ReactNode } from "react";
import { NavigationMenuButton } from "./Navigation";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  brand: ReactNode;
  currentPageLabel: string;
  actions?: ReactNode;
  drawerId: string;
  hasMobileQuickNavigation: boolean;
  navigationOpen: boolean;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function TopBar({
  brand,
  currentPageLabel,
  actions,
  drawerId,
  hasMobileQuickNavigation,
  navigationOpen,
  onOpenNavigation,
}: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div className={styles.start}>
        <NavigationMenuButton
          className={hasMobileQuickNavigation ? styles.menuButtonWithBottomNavigation : undefined}
          controls={drawerId}
          expanded={navigationOpen}
          onClick={onOpenNavigation}
        />
        <div className={styles.mobileBrand}>{brand}</div>
        <span className={styles.currentPage}>{currentPageLabel}</span>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : <div className={styles.spacer} />}
    </header>
  );
}
