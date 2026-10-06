import { useEffect, useId, useState } from "react";
import { ContentFrame } from "./ContentFrame";
import { DesktopSidebar, MobileBottomNavigation, NavigationDrawer } from "./Navigation";
import type { AppShellProps } from "./contracts";
import { EXPANDED_NAVIGATION_MEDIA_QUERY } from "./breakpoints";
import { TopBar } from "./TopBar";
import styles from "./AppShell.module.css";

export function AppShell({
  brand,
  navigation,
  activeItemId,
  currentPageLabel,
  children,
  headerActions,
  sidebarFooter,
  mobilePrimaryIds,
  onNavigate,
}: AppShellProps) {
  const drawerId = `nova-navigation-${useId()}`;
  const [navigationOpen, setNavigationOpen] = useState(false);

  useEffect(() => {
    const expandedViewport = window.matchMedia(EXPANDED_NAVIGATION_MEDIA_QUERY);
    const closeDrawerOnExpand = () => {
      if (expandedViewport.matches) setNavigationOpen(false);
    };
    expandedViewport.addEventListener("change", closeDrawerOnExpand);
    return () => expandedViewport.removeEventListener("change", closeDrawerOnExpand);
  }, []);

  const openNavigation = () => setNavigationOpen(true);
  const closeNavigation = () => setNavigationOpen(false);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#nova-main-content">
        Skip to main content
      </a>
      <DesktopSidebar
        activeItemId={activeItemId}
        brand={brand}
        groups={navigation}
        onNavigate={onNavigate}
        sidebarFooter={sidebarFooter}
      />
      <div className={styles.contentColumn}>
        <TopBar
          actions={headerActions}
          brand={brand}
          currentPageLabel={currentPageLabel}
          drawerId={drawerId}
          navigationOpen={navigationOpen}
          onOpenNavigation={openNavigation}
        />
        <ContentFrame aria-label={currentPageLabel}>
          {children}
        </ContentFrame>
      </div>
      <NavigationDrawer
        activeItemId={activeItemId}
        brand={brand}
        drawerId={drawerId}
        drawerOpen={navigationOpen}
        groups={navigation}
        onClose={closeNavigation}
        onNavigate={onNavigate}
        sidebarFooter={sidebarFooter}
      />
      <MobileBottomNavigation
        activeItemId={activeItemId}
        drawerId={drawerId}
        groups={navigation}
        mobilePrimaryIds={mobilePrimaryIds}
        drawerOpen={navigationOpen}
        onNavigate={onNavigate}
        onOpen={openNavigation}
      />
    </div>
  );
}

export type { AppShellProps } from "./contracts";
